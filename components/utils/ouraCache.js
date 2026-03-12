const _ouraCache={};
export function cachedOuraFetch(date,token,userId){const k=`${userId}|${date}`;if(_ouraCache[k])return _ouraCache[k];const p=fetch(`/api/oura?date=${date}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>{if(!r.ok){delete _ouraCache[k];return{error:"fetch_failed"};}return r.json();}).then(data=>{if(data.error&&data.error!=="no_token")delete _ouraCache[k];return data;}).catch(()=>{delete _ouraCache[k];return{error:"network"};});_ouraCache[k]=p;return p;}
export function clearOuraCache(userId){if(!userId){for(const k of Object.keys(_ouraCache))delete _ouraCache[k];return;}for(const k of Object.keys(_ouraCache)){if(k.startsWith(userId+"|"))delete _ouraCache[k];}}
export function bustOuraCacheDate(userId,date){delete _ouraCache[`${userId}|${date}`];}
