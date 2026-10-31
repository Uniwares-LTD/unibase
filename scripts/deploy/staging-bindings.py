"""Reconcile shared staging Firebase/Atlas resources, never production projects.

Uses explicit public configuration and protected files. API errors expose status
only. An uncertain mutation must be inspected before another apply.
"""
import base64
import json
import secrets
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPDigestAuthHandler, HTTPPasswordMgrWithDefaultRealm, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Provider redirect refused')


class Providers:
    def __init__(self, account, atlas):
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        self.google_opener = build_opener(NoRedirect())
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
        now = int(time.time())
        message = encode({'alg': 'RS256', 'typ': 'JWT'}) + b'.' + encode({
            'iss': account['client_email'], 'scope': 'https://www.googleapis.com/auth/cloud-platform',
            'aud': 'https://oauth2.googleapis.com/token', 'iat': now, 'exp': now + 300})
        key = serialization.load_pem_private_key(account['private_key'].encode(), password=None)
        assertion = message + b'.' + base64.urlsafe_b64encode(key.sign(message, padding.PKCS1v15(), hashes.SHA256())).rstrip(b'=')
        request = Request('https://oauth2.googleapis.com/token', data=urlencode({
            'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion.decode()}).encode())
        with self.google_opener.open(request, timeout=30) as response:
            self.google_headers = {'Authorization': 'Bearer ' + json.load(response)['access_token']}
        self.atlas_headers = {'Accept': 'application/vnd.atlas.2025-03-12+json'}
        if atlas.get('publicKey') and atlas.get('privateKey'):
            manager = HTTPPasswordMgrWithDefaultRealm()
            manager.add_password(None, 'https://cloud.mongodb.com', atlas['publicKey'], atlas['privateKey'])
            self.atlas_opener = build_opener(NoRedirect(), HTTPDigestAuthHandler(manager))
        else:
            self.atlas_opener = build_opener(NoRedirect())
            auth = base64.b64encode((atlas['clientId'] + ':' + atlas['clientSecret']).encode()).decode()
            request = Request('https://cloud.mongodb.com/api/oauth/token', data=b'grant_type=client_credentials',
                              headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded'})
            with self.atlas_opener.open(request, timeout=30) as response:
                self.atlas_headers['Authorization'] = 'Bearer ' + json.load(response)['access_token']

    def request(self, provider, method, url, body=None, missing=False):
        headers = self.google_headers if provider == 'google' else self.atlas_headers
        opener = self.google_opener if provider == 'google' else self.atlas_opener
        request = Request(url, method=method, headers={'Content-Type': 'application/json', **headers},
                          data=None if body is None else json.dumps(body).encode())
        try:
            with opener.open(request, timeout=30) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise ValueError('Provider response too large')
                return json.loads(raw) if raw else {}
        except HTTPError as error:
            if missing and error.code == 404:
                return None
            raise ValueError(provider + ' HTTP ' + str(error.code)) from None


def discover(api, config, project, recorded_app_id=None):
    environment=config["environment"]
    if environment == 'production':
        import hashlib
        identity = api.request('google', 'GET', 'https://cloudresourcemanager.googleapis.com/v3/projects/' + config['google']['projectId'])
        labels = identity.get('labels', {})
        if identity.get('state') != 'ACTIVE' or labels.get('unibase-owner') != hashlib.sha256(project.encode()).hexdigest()[:24] or labels.get('unibase-environment') != environment or identity.get('parent') != config['google']['parent']:
            raise ValueError('Production Google project ownership conflict; owner must reconcile before setup')
    google = 'https://firebase.googleapis.com/v1beta1/projects/' + config['google']['projectId']
    atlas = 'https://cloud.mongodb.com/api/atlas/v2/groups/' + config['atlas']['projectId'] + '/'
    apps, page = [], ''
    while True:
        response = api.request('google', 'GET', google + '/webApps?pageSize=100' + ('&pageToken=' + quote(page, safe='') if page else ''))
        apps.extend(response.get('apps', []))
        page = response.get('nextPageToken')
        if not page:
            break
        if len(apps) > 1000:
            raise ValueError('Too many Firebase registrations')
    matches = [app for app in apps if (app.get('appId') == recorded_app_id if recorded_app_id else app.get('displayName') == project + '-' + environment)]
    if recorded_app_id and not matches:
        raise ValueError('Recorded Firebase app is not in the selected project')
    if len(matches) > 1:
        raise ValueError('Ambiguous Firebase registrations; select recorded ID manually')
    auth = api.request('google', 'GET', 'https://identitytoolkit.googleapis.com/admin/v2/projects/' + config['google']['projectId'] + '/config')
    user = api.request('atlas', 'GET', atlas + 'databaseUsers/admin/' + quote(config['atlas']['mongoUser']), missing=True)
    expected = [{'roleName': 'readWrite', 'databaseName': config['runtime']['MONGODB_DATABASE']}]
    scope = [{'name': config['atlas']['clusterName'], 'type': 'CLUSTER'}]
    if user and (user.get('roles') != expected or user.get('scopes') != scope):
        raise ValueError('Existing Atlas user privileges or cluster scope differ')
    cluster = api.request('atlas', 'GET', atlas + 'clusters/' + quote(config['atlas']['clusterName']))
    endpoint = urlsplit(cluster['connectionStrings']['standardSrv'])
    if endpoint.scheme != 'mongodb+srv' or endpoint.username or not endpoint.hostname:
        raise ValueError('Unexpected Atlas cluster endpoint')
    access = api.request('atlas', 'GET', atlas + 'accessList')
    cidr = config['atlas']['vpsEgressCidr']
    allowed = any(item.get('cidrBlock') == cidr or item.get('ipAddress') == cidr.split('/')[0] for item in access.get('results', []))
    return {'firebaseAppId': matches[0]['appId'] if matches else None,
            'authorizedDomainPresent': urlsplit(config['runtime']['APP_ORIGIN']).hostname in auth.get('authorizedDomains', []),
            'atlasUserPresent': user is not None, 'atlasHostAllowed': allowed, 'atlasHostname': endpoint.hostname,
            'writePermissions': 'not-proven-by-read-access'}


def reconcile(api, config, project, observed, directory, save_new, journal):
    """journal(name, operation) persists intent before calling a mutating API."""
    environment=config["environment"]
    google_project = config['google']['projectId']
    google = 'https://firebase.googleapis.com/v1beta1/projects/' + google_project
    app_id = observed['firebaseAppId']
    if not app_id:
        operation = journal('firebase-web-create', lambda: api.request('google', 'POST', google + '/webApps', {'displayName': project + '-' + environment}))
        for _ in range(60):
            if operation.get('done'):
                break
            time.sleep(2)
            operation = api.request('google', 'GET', 'https://firebase.googleapis.com/v1beta1/' + operation['name'])
        if not operation.get('done') or operation.get('error'):
            raise ValueError('Firebase creation incomplete; inspect recorded operation before retry')
        app_id = operation['response']['appId']
    web = api.request('google', 'GET', google + '/webApps/' + quote(app_id, safe='') + '/config')
    if web.get('projectId') != google_project or web.get('appId') != app_id:
        raise ValueError('Firebase configuration identity differs')
    web['authDomain'] = urlsplit(config['runtime']['APP_ORIGIN']).hostname
    filename = 'firebase-staging-web.json' if project == 'unibase' and environment == 'staging' else project + '-'+environment+'-web.json'
    saved_web = json.loads(save_new(directory / filename, json.dumps(web, indent=2)))
    if any(saved_web.get(key) != web.get(key) for key in ('projectId', 'appId', 'apiKey', 'authDomain')):
        raise ValueError('Saved Firebase binding differs; preserve and review it')
    auth_url = 'https://identitytoolkit.googleapis.com/admin/v2/projects/' + google_project + '/config'
    auth = api.request('google', 'GET', auth_url)
    domains = auth.get('authorizedDomains', [])
    if web['authDomain'] not in domains:
        journal('firebase-authorized-domain', lambda: api.request('google', 'PATCH', auth_url + '?updateMask=authorizedDomains', {'authorizedDomains': domains + [web['authDomain']]}))
        verified = api.request('google', 'GET', auth_url)
        if not set(domains + [web['authDomain']]).issubset(verified.get('authorizedDomains', [])):
            raise ValueError('Firebase authorized-domain readback differs')
    # Never auto-widen Atlas network access. Owner confirms exact host allocation first.
    if not observed['atlasHostAllowed']:
        raise ValueError('Atlas host access requires a reviewed owner action')
    db_file = directory / (project + '-'+environment+'-database.json')
    if observed['atlasUserPresent'] and not db_file.exists():
        raise ValueError('Existing database user password unavailable; recovery required')
    private = json.loads(save_new(db_file, json.dumps({'database': config['runtime']['MONGODB_DATABASE'],
                        'username': config['atlas']['mongoUser'], 'password': secrets.token_urlsafe(32)}, indent=2)))
    if private.get('database') != config['runtime']['MONGODB_DATABASE'] or private.get('username') != config['atlas']['mongoUser']:
        raise ValueError('Saved database identity differs')
    atlas = 'https://cloud.mongodb.com/api/atlas/v2/groups/' + config['atlas']['projectId'] + '/'
    if not observed['atlasUserPresent']:
        journal('atlas-user-create', lambda: api.request('atlas', 'POST', atlas + 'databaseUsers', {
            'databaseName': 'admin', 'username': private['username'], 'password': private['password'],
            'roles': [{'roleName': 'readWrite', 'databaseName': private['database']}],
            'scopes': [{'name': config['atlas']['clusterName'], 'type': 'CLUSTER'}]}))
    verified = api.request('atlas', 'GET', atlas + 'databaseUsers/admin/' + quote(private['username']))
    if verified.get('roles') != [{'roleName': 'readWrite', 'databaseName': private['database']}] or verified.get('scopes') != [{'name': config['atlas']['clusterName'], 'type': 'CLUSTER'}]:
        raise ValueError('Atlas runtime-user readback differs')
    account = json.loads((directory / f'firebase-{environment}-service-account.json').read_text(encoding='utf-8-sig'))
    host_input = {'firebase': account, 'firebaseApiKey': web['apiKey'], 'firebaseAppId': app_id,
                  'mongodbUri': 'mongodb+srv://' + quote(private['username'], safe='') + ':' + quote(private['password'], safe='') + '@' + observed['atlasHostname'] + '/?retryWrites=true&w=majority'}
    saved = json.loads(save_new(directory / (project + '-'+environment+'-host-input.json'), json.dumps(host_input, indent=2)))
    if saved != host_input:
        raise ValueError('Existing host input differs; operator review required')
    return app_id
