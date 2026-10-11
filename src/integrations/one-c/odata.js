import { defaultCanonicalView, mapFields } from './mapping.js';

export function buildOneCODataCreateRequest(envelope, config, env = process.env) {
  if (!config?.baseUrl || !config?.entitySet) throw new Error('one_c_odata_config_missing');
  const body = mapFields(defaultCanonicalView(envelope), config.fieldMap || {});
  if (!Object.keys(body).length) throw new Error('one_c_odata_field_map_empty');

  const headers = {
    'content-type': 'application/json',
    'x-idempotency-key': envelope.intakeId
  };
  if (config.auth?.type === 'basic_env') {
    const value = env[config.auth.envVar];
    if (!value) throw new Error('one_c_auth_env_missing');
    headers.authorization = value.startsWith('Basic ') ? value : `Basic ${value}`;
  }

  return {
    method: 'POST',
    url: `${config.baseUrl.replace(/\/$/, '')}/odata/standard.odata/${config.entitySet}`,
    headers,
    body
  };
}
