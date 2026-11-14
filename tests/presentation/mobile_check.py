"""Responsive and actual multi-touch input checks in Chromium emulation.
Not a real iPhone/Safari or Android hardware benchmark.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
import os, shutil
CHROMIUM=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
R=Path(__file__).resolve().parents[2]
(R/'tests/presentation/artifacts').mkdir(parents=True,exist_ok=True)
HTML=(R/'web/public/EMBER_Presentation.html').read_text()
checks=[]
def check(name,value):
    checks.append({'name':name,'passed':bool(value)})
    print(('PASS ' if value else 'FAIL ')+name,flush=True)
    if not value: raise AssertionError(name)
args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROMIUM,headless=True,timeout=20000,args=args)
    for width,height in [(320,740),(390,844),(430,932),(768,1024),(844,390)]:
        c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=2,has_touch=True,is_mobile=True,reduced_motion='reduce')
        pg=c.new_page();errors=[];requests=[]
        pg.on('pageerror',lambda e:errors.append(str(e)))
        pg.route('**/*',lambda r:(requests.append(r.request.url),r.abort()))
        pg.set_content(HTML,wait_until='load',timeout=20000)
        pg.wait_for_function('!!window.__EMBER__?.renderer && __EMBER__.renderer.count>0',timeout=20000)
        pg.evaluate('__EMBER__.renderer.maxPixels=170000;__EMBER__.renderer.resize()')
        check(f'{width}px WebGL renders',pg.evaluate('__EMBER__.renderer.count>0'))
        check(f'{width}px reduced motion starts paused',pg.evaluate('!__EMBER__.state.playing'))
        check(f'{width}px zero external requests',not requests)
        check(f'{width}px no horizontal overflow',pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        check(f'{width}px source and chapter targets at least 44px',pg.evaluate('''()=>['evidenceButton','compareButton','pauseButton','flowButton','resetCamera','exploreButton','presentButton','gravity','airflow','oxygen'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>=44 && r.height>=44;})'''))
        check(f'{width}px fixed navigation visible',pg.evaluate('''()=>{const r=document.querySelector('.footer').getBoundingClientRect();return r.bottom<=innerHeight+1 && r.top>=0;}'''))
        if width==390:
            check('phone 3D begins in first viewport',pg.locator('#stage').bounding_box()['y']<350)
            pg.screenshot(path=str(R/'tests/presentation/artifacts/mobile.png'),full_page=True,timeout=15000)
            pg.screenshot(path=str(R/'tests/presentation/artifacts/mobile-first-screen.png'),timeout=15000)
            pg.evaluate("document.getElementById('stage').scrollIntoView({block:'start'})")
            pg.wait_for_timeout(100)
            box=pg.locator('#scene').bounding_box();cx=box['x']+box['width']*.5;cy=box['y']+box['height']*.50
            cd=c.new_cdp_session(pg)
            yaw=pg.evaluate('__EMBER__.renderer.yaw')
            cd.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':cx,'y':cy,'id':1}]})
            cd.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':cx+35,'y':cy+12,'id':1}]})
            cd.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            check('one-finger touch rotates camera',pg.evaluate('__EMBER__.renderer.yaw')!=yaw)
            z=pg.evaluate('__EMBER__.renderer.zoom')
            pts=lambda d:[{'x':cx-d,'y':cy,'id':1},{'x':cx+d,'y':cy,'id':2}]
            cd.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':pts(35)})
            for d in [40,45,50,55]:cd.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':pts(d)})
            cd.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            check('two-finger pinch zooms camera',pg.evaluate('__EMBER__.renderer.zoom')<z)
            check('released touches leave no stuck gesture',pg.evaluate('__EMBER__.renderer.pointers.size===0'))
            pg.locator('#resetCamera').tap();check('tap resets camera',abs(pg.evaluate('__EMBER__.renderer.yaw')+.16)<1e-6)
            pg.locator('#pauseButton').tap();before=pg.evaluate('__EMBER__.renderer.time')
            pg.wait_for_function('(n)=>__EMBER__.renderer.time>n',arg=before,timeout=8000)
            check('tap starts animation',pg.evaluate('__EMBER__.state.playing'))
            pg.locator('#pauseButton').tap()
            pg.locator('#oxygen').scroll_into_view_if_needed();sb=pg.locator('#oxygen').bounding_box()
            pg.touchscreen.tap(sb['x']+sb['width']*.8,sb['y']+sb['height']*.5)
            check('slider responds to touch',pg.evaluate('__EMBER__.state.oxygen>29'))
            pg.locator('[data-step="3"]').tap();check('sticky chapter navigation responds to touch',pg.evaluate('__EMBER__.state.step===3'))
            pg.locator('#evidenceButton').tap()
            check('drawer locks background scroll',pg.evaluate('document.body.classList.contains("panel-open") && getComputedStyle(document.body).overflow==="hidden"'))
            check('evidence table fits phone',pg.evaluate('document.getElementById("drawer").scrollWidth<=innerWidth'))
            pg.screenshot(path=str(R/'tests/presentation/artifacts/mobile-evidence.png'),timeout=15000)
            pg.locator('#closeDrawer').tap();check('closing drawer restores scrolling',pg.evaluate('!document.body.classList.contains("panel-open")'))
        if width==320:
            pg.locator('#evidenceButton').tap();check('320px evidence fits narrow phone',pg.evaluate('document.getElementById("drawer").scrollWidth<=innerWidth'))
            pg.locator('#closeDrawer').tap()
            pg.screenshot(path=str(R/'tests/presentation/artifacts/mobile-320.png'),full_page=True,timeout=15000)
        check(f'{width}px no JavaScript errors',not errors)
        c.close()
    b.close()
report={'checks':checks,'passed':sum(x['passed'] for x in checks),'total':len(checks),'environment':'Chromium mobile emulation; ANGLE SwiftShader; actual CDP touch events; not physical devices'}
(R/'tests/presentation/artifacts/mobile-tests.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'passed':report['passed'],'total':report['total']}))
