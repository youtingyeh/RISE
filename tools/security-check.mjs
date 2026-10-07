// Return categories only. Never print detected secret values in CI logs.
export function secretFindings(source){
 const findings=new Set();
 if(/sb_secret_[A-Za-z0-9_-]{10,}/.test(source))findings.add('疑似 Supabase secret key');
 if(/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(source))findings.add('疑似私鑰');
 if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/.test(source))findings.add('疑似 API 私密金鑰');
 for(const token of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){
  try{const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());if(claims.role==='service_role')findings.add('疑似 service_role JWT');}catch{}
 }
 return [...findings];
}
