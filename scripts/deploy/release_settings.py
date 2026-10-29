"""Application settings accepted from a release by the installed host policy.

Adding keys here requires an operator-reviewed control update. Infrastructure,
provider bindings and secrets remain part of the registered configuration hash.
"""
import copy
import hashlib
import json

KEYS = frozenset({'DIAGNOSTICS_ENABLED'})


def validate_settings(settings, target):
    if (target not in ('local', 'staging', 'production') or
            not isinstance(settings, dict) or set(settings) != KEYS):
        raise ValueError('Unknown or missing release setting')
    value = settings['DIAGNOSTICS_ENABLED']
    if not isinstance(value, str) or value not in ('true', 'false'):
        raise ValueError('Invalid diagnostics setting')
    if target == 'production' and value != 'false':
        raise ValueError('Diagnostics is forbidden in production')
    return dict(settings)


def settings_for(config):
    return validate_settings({key: config['runtime'].get(key, 'false') for key in KEYS}, config['environment'])


def configuration_hash(config):
    settings_for(config)
    fixed = copy.deepcopy(config)
    for key in KEYS:
        fixed['runtime'].pop(key, None)
    return hashlib.sha256(json.dumps(fixed, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
