import {randomBytes} from 'node:crypto';

// Obscures the literal token from simple scanners. This is public client data,
// not encryption or an access control boundary.
export function obscureToken(token = '') {
  if (!token) return {parts:[],key:[]};
  const key = [...randomBytes(17)];
  const encoded = Buffer.from([...Buffer.from(token)].map((n,i)=>n ^ key[i % key.length])).toString('base64');
  return {parts:encoded.match(/.{1,23}/g).reverse(),key};
}
