import {restoreProfile} from './model.js';
export const MODE_KEYS={original:'arrow-escape-v1',color:'arrow-escape-color-v1',adventure:'arrow-escape-adventure-v1'};
export const MODE_SELECTION_KEY='arrow-escape-selected-mode';
/** Every campaign owns its run, results, unlocks and tutorial state. */
export function readCampaigns(storage,campaignLevels){
 return Object.fromEntries(Object.entries(campaignLevels).map(([mode,levels])=>{
  let raw=null;try{raw=JSON.parse(storage.getItem(MODE_KEYS[mode]));}catch{}
  return[mode,{levels,profile:restoreProfile(raw,levels)}];
 }));
}
export function writeCampaign(storage,mode,profile){if(!MODE_KEYS[mode])throw new Error('Unknown campaign');storage.setItem(MODE_KEYS[mode],JSON.stringify(profile));}
