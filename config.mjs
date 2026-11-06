export function runtimeConfig(env=process.env){
  const port=Number(env.PORT||4173),host=env.HOST||(env.RENDER==='true'?'0.0.0.0':'127.0.0.1');
  const publicOrigin=env.APP_ORIGIN||env.RENDER_EXTERNAL_URL||null;
  const databaseUrl=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  const trustedProxyHops=Number(env.TRUST_PROXY_HOPS||0);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  if(!Number.isInteger(trustedProxyHops)||trustedProxyHops<0||trustedProxyHops>4)throw new Error('TRUST_PROXY_HOPS must be 0–4');
  if(!['127.0.0.1','localhost','::1'].includes(host)&&!publicOrigin)throw new Error('Set APP_ORIGIN before listening beyond localhost');
  if((env.RENDER==='true'||env.REQUIRE_REMOTE_DATABASE==='true')&&(!databaseUrl||!authToken))throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required on this host');
  return {port,host,publicOrigin,databaseUrl,authToken,trustedProxyHops,hostingProfile:env.HOSTING_PROFILE||''};
}
