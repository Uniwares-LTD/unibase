"""Separate image-owned application flags from the registered host profile.

Only these flags are carried inside the image. Every infrastructure/provider
setting retains the installed v1 controller's configuration hash check.
"""
import copy
import hashlib
import json
from deployment_contract import load, project

KEYS = frozenset(name.split('.')[1] for name, rule in load()['settings'].items()
                 if name.startswith('runtime.') and rule['owner'] == 'image')


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


def host_configuration(config):
    settings_for(config)
    return project(config)


def configuration_hash(config):
    return hashlib.sha256(json.dumps(host_configuration(config), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
