import { defaultCanonicalView, mapFields } from './mapping.js';

export function buildOneCHttpServiceRequest(envelope, config, env = process.env) {
  if (!config?.baseUrl || !config?.path) throw new Error('one_c_http_config_missing');
  const body = config.fieldMap ? mapFields(defaultCanonicalView(envelope), config.fieldMap) : defaultCanonicalView(envelope);
  const headers = {
    'content-type': 'application/json',
    'x-idempotency-key': envelope.intakeId
  };

  if (config.auth?.type === 'basic_env') {
    const value = env[config.auth.envVar];
    if (!value) throw new Error('one_c_auth_env_missing');
    headers.authorization = value.startsWith('Basic ') ? value : `Basic ${value}`;
  }
  if (config.auth?.type === 'bearer_env') {
    const value = env[config.auth.envVar];
    if (!value) throw new Error('one_c_auth_env_missing');
    headers.authorization = value.startsWith('Bearer ') ? value : `Bearer ${value}`;
  }

  return {
    method: 'POST',
    url: `${config.baseUrl.replace(/\/$/, '')}/${config.path.replace(/^\//, '')}`,
    headers,
    body
  };
}

export function injectOneCRuntimeAuth(request, config, env = process.env) {
  const out={...request,headers:{...(request.headers||{})}};
  if(!config?.auth)return out;
  const value=env[config.auth.envVar];if(!value)throw new Error('one_c_auth_env_missing');
  if(config.auth.type==='basic_env')out.headers.authorization=value.startsWith('Basic ')?value:`Basic ${value}`;
  else if(config.auth.type==='bearer_env')out.headers.authorization=value.startsWith('Bearer ')?value:`Bearer ${value}`;
  else throw new Error('one_c_auth_type_unsupported');
  return out;
}
