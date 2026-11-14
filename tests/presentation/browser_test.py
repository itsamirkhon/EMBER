"""Desktop WebGL regression tests. Uses a network-blocked document.
The same-origin loader contract is tested separately with mocked fetch, not a live server.
"""
import hashlib, json, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
import os, shutil
CHROMIUM=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
ROOT=Path(__file__).resolve().parents[2]
(ROOT/'tests/presentation/artifacts').mkdir(parents=True,exist_ok=True)
HTML=(ROOT/'web/public/EMBER_Presentation.html').read_text()
DATA=json.loads((ROOT/'web/public/ember/snapshot.json').read_text())['tests']
REPORT={'checks':[], 'browser':'Chromium / ANGLE SwiftShader under Xvfb','date':'2026-11-14','mode':'network-blocked HTML document; loader contract tested separately'}
def check(name,cond,detail=None):
 REPORT['checks'].append({'name':name,'passed':bool(cond),'detail':detail})
 print(('PASS ' if cond else 'FAIL ')+name,flush=True)
 if not cond: raise AssertionError(name+': '+str(detail))
def canvas_hash(page):return hashlib.sha256(page.locator('#scene').screenshot()).hexdigest()
class Server(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path.startswith('/EMBER_Presentation.html'):
   content=HTML.encode();mime='text/html'
  elif self.path=='/data/tests.json':
   content=json.dumps(DATA).encode();mime='application/json'
  else:
   self.send_response(404);self.end_headers();return
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
 def log_message(self,*args):pass
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CHROMIUM,headless=True,timeout=20000,args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'])
 ctx=b.new_context(viewport={'width':1440,'height':950},device_scale_factor=1)
 page=ctx.new_page();errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/*',lambda route:(requests.append(route.request.url),route.abort()))
 page.set_content(HTML,wait_until='load',timeout=30000)
 page.wait_for_function('window.__EMBER__?.renderer?.count >= 2',timeout=30000)
 check('native WebGL shader compiles and renders',page.evaluate('!!__EMBER__.renderer && __EMBER__.renderer.count>0'))
 check('standalone requests no external assets',len(requests)==0,requests)
 check('no initial JavaScript errors',not errors,errors)
 check('desktop has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 first=canvas_hash(page);page.wait_for_timeout(500);second=canvas_hash(page)
 check('motion changes actual rendered pixels',first!=second)
 page.click('#pauseButton');page.wait_for_timeout(100)
 t=page.evaluate('__EMBER__.renderer.time');h1=canvas_hash(page);page.wait_for_timeout(200);h2=canvas_hash(page)
 check('pause freezes simulation clock',t==page.evaluate('__EMBER__.renderer.time'))
 check('pause freezes actual frame pixels',h1==h2)
 box=page.locator('#scene').bounding_box();x=box['x']+box['width']*.3;y=box['y']+box['height']*.55
 yaw=page.evaluate('__EMBER__.renderer.yaw');page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+75,y+20,steps=5);page.mouse.up();page.wait_for_timeout(200)
 check('drag changes 3D camera',page.evaluate('__EMBER__.renderer.yaw')!=yaw)
 zoom=page.evaluate('__EMBER__.renderer.zoom');page.mouse.wheel(0,130);page.wait_for_timeout(200)
 check('wheel changes zoom',page.evaluate('__EMBER__.renderer.zoom')!=zoom)
 page.click('#resetCamera');check('reset restores camera',abs(page.evaluate('__EMBER__.renderer.yaw')+.16)<1e-8)
 page.click('#pauseButton');page.wait_for_function('(t)=>__EMBER__.renderer.time>t',arg=t,timeout=10000);check('resume advances clock',page.evaluate('__EMBER__.renderer.time')>t)
 page.evaluate('__EMBER__.renderer.maxPixels=180000;__EMBER__.renderer.resize()');page.click('[data-step="1"]');check('chapter navigation sets microgravity and airflow',page.evaluate('__EMBER__.state.step===1 && __EMBER__.state.gravity===0 && __EMBER__.state.flow===7'))
 page.locator('#airflow').fill('18');page.locator('#airflow').dispatch_event('input');check('airflow slider updates scene state',page.evaluate('__EMBER__.state.flow===18'))
 page.locator('#gravity').fill('0.5');page.locator('#gravity').dispatch_event('input');check('gravity slider updates single chamber',page.evaluate('__EMBER__.state.gravity===.5 && !__EMBER__.state.split'))
 page.locator('#oxygen').fill('32');page.locator('#oxygen').dispatch_event('input');check('oxygen slider updates query',page.evaluate('__EMBER__.query().o2Pct===32'))
 page.locator('#pauseButton').click();page.locator('#scene').click(position={'x':250,'y':250});page.keyboard.press('ArrowRight');check('keyboard chapter navigation works',page.evaluate('__EMBER__.state.step===2'))
 page.screenshot(path=str(ROOT/'tests/presentation/artifacts/03-trace.png'))
 page.click('#storyAction');check('evidence drawer opens and traps background',page.evaluate('__EMBER__.state.drawer==="evidence" && document.querySelector("main").inert'))
 check('real source B1 is shown',page.locator('#drawerBody').inner_text().find('B1')>=0)
 check('missing source fields stay explicit',page.locator('#drawerBody').inner_text().find('Not reported')>=0)
 with page.expect_download() as download:
  page.click('#exportEvidence')
 item=download.value;item.save_as(str(ROOT/'tests/presentation/artifacts/evidence-export.json'))
 export=json.loads((ROOT/'tests/presentation/artifacts/evidence-export.json').read_text());check('export preserves sources and no risk probability',export['support']['pBurn'] is None and export['renderer']['validated'] is False)
 page.keyboard.press('Escape');check('escape closes drawer and restores background',page.evaluate('__EMBER__.state.drawer===null && !document.querySelector("main").inert'))
 page.click('[data-step="3"]');page.click('#storyAction');check('lunar evidence is unsupported',page.evaluate('__EMBER__.assessment().status==="unsupported"'))
 check('gravity gap is explicit',page.locator('#drawerBody').inner_text().find('No matching gravity')>=0)
 page.screenshot(path=str(ROOT/'tests/presentation/artifacts/04-evidence-gap.png'))
 with page.expect_file_chooser() as chooser:
  page.click('#importEvidence')
 chooser.value.set_files({'name':'bad.json','mimeType':'application/json','buffer':b'{bad'})
 page.wait_for_timeout(50);check('invalid JSON leaves current data intact',page.evaluate('__EMBER__.state.rows.length===14'))
 valid=DATA[:2]
 page.locator('#importFile').set_input_files({'name':'tests.json','mimeType':'application/json','buffer':json.dumps(valid).encode()})
 page.wait_for_function('__EMBER__.state.rows.length===2')
 check('import accepts existing engine TestRow format',page.evaluate('__EMBER__.state.dataMode==="engine dataset"'))
 page.keyboard.press('Escape');page.click('#exploreButton');page.locator('#pInput').fill('-2');page.click('#applyQuery');check('invalid mission pressure rejected',page.evaluate('__EMBER__.state.pressure===70.3'))
 page.locator('#pInput').fill('88');page.click('#applyQuery');check('valid pressure updates source query',page.evaluate('__EMBER__.query().pressureKpa===88'))
 page.keyboard.press('Escape');page.click('#sourcesButton');check('sources and honest model limits visible','not CFD' in page.locator('#drawerBody').inner_text());page.keyboard.press('Escape')
 page.click('#presentButton');check('guided presentation starts',page.locator('#presentText').inner_text()=='Stop tour');page.click('#presentButton');check('guided presentation stops',page.locator('#presentText').inner_text()=='Present')
 check('no interaction JavaScript errors',not errors,errors)
 b.close()
REPORT['passed']=sum(c['passed'] for c in REPORT['checks'])
REPORT['total']=len(REPORT['checks'])
(ROOT/'tests/presentation/artifacts/browser-tests.json').write_text(json.dumps(REPORT,indent=2))
print(json.dumps({'passed':REPORT['passed'],'total':REPORT['total']}),flush=True)
