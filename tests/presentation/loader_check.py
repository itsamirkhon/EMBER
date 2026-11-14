import json
from pathlib import Path
from playwright.sync_api import sync_playwright
import os, shutil
CHROMIUM=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
R=Path(__file__).resolve().parents[2]
(R/'tests/presentation/artifacts').mkdir(parents=True,exist_ok=True);html=(R/'web/public/EMBER_Presentation.html').read_text();rows=json.loads((R/'web/public/ember/snapshot.json').read_text())['tests'];checks={}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CHROMIUM,headless=True,timeout=15000,args=['--no-sandbox','--disable-dev-shm-usage']);pg=b.new_page(viewport={'width':1280,'height':850});pg.evaluate('HTMLCanvasElement.prototype.getContext=function(){return null;}');pg.set_content(html)
 checks['no_GPU_explicit_fallback']=pg.locator('#gpuError').is_visible();pg.click('[data-step="3"]');pg.click('#storyAction');checks['sources_work_without_GPU']=pg.locator('#drawer').is_visible();pg.keyboard.press('Escape')
 bad=[{**rows[0],'testId':'<img src=x onerror="window.HACKED=1">'}];pg.evaluate('(data)=>__EMBER__.adoptData(data,"fixture")',bad);pg.click('#evidenceButton');checks['imported_HTML_escaped']=pg.locator('#drawerBody img').count()==0 and pg.evaluate('!window.HACKED');pg.keyboard.press('Escape')
 result=pg.evaluate('''async(data)=>{let called=null;await __EMBER__.loadRepoData('https://example.test/EMBER/EMBER_Presentation.html',async(url,opts)=>{called={url:String(url),credentials:opts.credentials};return {ok:true,json:async()=>data};});return {called,count:__EMBER__.state.rows.length,mode:__EMBER__.state.dataMode};}''',rows)
 checks['loader_correct_relative_path']=result['called']['url']=='https://example.test/EMBER/data/tests.json';checks['loader_same_origin_credentials']=result['called']['credentials']=='same-origin';checks['loader_adopts_valid_TestRows']=result['count']==14 and result['mode']=='engine dataset'
 pg.evaluate("async()=>{await __EMBER__.loadRepoData('https://example.test/EMBER_Presentation.html',async()=>{throw new Error('offline')});}")
 checks['offline_failure_preserves_dataset']=pg.evaluate('__EMBER__.state.rows.length===14')
 pg.evaluate("async()=>{await __EMBER__.loadRepoData('https://example.test/EMBER_Presentation.html',async()=>({ok:false}));}")
 checks['HTTP_failure_preserves_dataset']=pg.evaluate('__EMBER__.state.rows.length===14')
 pg.evaluate("async()=>{await __EMBER__.loadRepoData('https://example.test/EMBER_Presentation.html',async()=>({ok:true,json:async()=>({bad:'schema'})}));}")
 checks['bad_schema_preserves_dataset']=pg.evaluate('__EMBER__.state.rows.length===14')
 b.close()
(R/'tests/presentation/artifacts/loader-tests.json').write_text(json.dumps({'checks':checks,'note':'Fetch contract mocked. Live local HTTP navigation blocked by browser administration policy.'},indent=2));print(checks);assert all(checks.values())
