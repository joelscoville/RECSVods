import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { SearchUnit } from '../../site/lib/display';
import { parse } from 'yaml';
import type { RecordingSource } from '../../site/lib/recording-schema';
import { parseTimecode } from '../../site/lib/timecode';

/** A recording file as written. (The build checks it in full; tests only read it.) */
export function readRecording(id: string): RecordingSource {
  return parse(readFileSync(`services/${id}.yaml`, 'utf8')) as RecordingSource;
}
export const seconds = parseTimecode;
export const searchMetadata = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8'));
export const previewUnits = searchMetadata.units as SearchUnit[];
export function unitFor(id: string): SearchUnit {
  const unit = previewUnits.find(item => item.id === id);
  if (!unit) throw new Error(`Missing required search unit: ${id}`);
  return unit;
}

/** A stand-in for YouTube's IFrame API: records seeks and the upload loaded, and never plays anything.
 * It exercises the real player code; it does not replace a manual check of actual YouTube playback. */
interface FakeYouTubeOptions { failFirst?: boolean; readyDelay?: number; transitionDelay?: number; playbackRates?: number[]; rejectRate?: number; rejectRateAfterTransition?: number }
const fakeYouTubeScript = ({ failFirst = false, readyDelay = 0, transitionDelay = 0, playbackRates = [0.5, 1, 1.5, 2], rejectRate = -1, rejectRateAfterTransition = -1 }: FakeYouTubeOptions) => `let attempts=0;window.YT={Player:class{
  constructor(host,options){this.options=options;this.videoId=options.videoId;this.time=options.playerVars.start||0;this.state=2;this.ticks=0;this.loads=[options.videoId];this.rate=1;this.rateRequests=[];this.transitioning=false;this.transition=0;
    this.iframe=document.createElement('iframe');host.replaceWith(this.iframe);window.testPlayer=this;
    setTimeout(()=>${failFirst}&&attempts++===0?options.events.onError({data:100}):options.events.onReady({target:this}),${readyDelay})}
  change(state){this.state=state;setTimeout(()=>{this.options.events.onStateChange&&this.options.events.onStateChange({data:state})},0)}
  seekTo(time){this.time=time}playVideo(){this.change(1)}pauseVideo(){this.change(2)}
  transitionTo(t,state){const generation=++this.transition;this.transitioning=true;this.videoId=t.videoId;this.time=t.startSeconds;this.loads.push(t.videoId);this.rate=1;this.change(3);
    setTimeout(()=>{if(generation!==this.transition)return;this.rate=1;this.transitioning=false;this.change(state)},${transitionDelay})}
  loadVideoById(t){this.transitionTo(t,1)}
  cueVideoById(t){this.transitionTo(t,5)}
  setPlaybackRate(rate){this.rateRequests.push(rate);if(!this.transitioning&&${JSON.stringify(playbackRates)}.includes(rate)&&rate!==${rejectRate}&&!(this.loads.length>1&&rate===${rejectRateAfterTransition})){
    this.rate=rate;setTimeout(()=>this.options.events.onPlaybackRateChange&&this.options.events.onPlaybackRateChange({data:rate}),0)}}
  getPlaybackRate(){return this.rate}getAvailablePlaybackRates(){return ${JSON.stringify(playbackRates)}}
  getCurrentTime(){this.ticks++;return this.time}getPlayerState(){return this.state}getIframe(){return this.iframe}destroy(){this.iframe.remove()}
}};window.onYouTubeIframeAPIReady();`;
/** `failFirst`: the first player reports the video unavailable, as YouTube does for a removed upload. */
export async function fakeYouTube(page: Page, options: FakeYouTubeOptions = {}) {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: fakeYouTubeScript(options) }));
}
/** The upload holding a recording time, and the time within it. */
export function uploadAt(recordingId: string, time: number): { id: string; time: number } {
  let start = 0;
  const uploads = readRecording(recordingId).uploads;
  for (const [i, upload] of uploads.entries()) {
    const skip = parseTimecode(upload.uploadSkip ?? '0:00'), end = start + parseTimecode(upload.uploadDuration) - skip;
    if (time < end || i === uploads.length - 1) return { id: upload.youtubeId, time: skip + time - start };
    start = end;
  }
  throw new Error(`${recordingId} has no uploads`);
}
export interface TestPlayer { time: number; state: number; ticks: number; videoId: string; loads: string[]; rate: number; rateRequests: number[]; transitioning: boolean }
export const player = (page: Page) => page.evaluate(() => (window as unknown as { testPlayer?: TestPlayer }).testPlayer);
export const setPlayerTime = (page: Page, time: number) => page.evaluate(value => { (window as unknown as { testPlayer: TestPlayer }).testPlayer.time = value; }, time);
