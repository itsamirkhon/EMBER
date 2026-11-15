precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uGravity;
uniform float uFlow;
uniform float uOxygen;
uniform float uPressure;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uSplit;
uniform float uTransport;
uniform float uFuel;
uniform float uAnimate;
const float PI=3.14159265359;

float hash31(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return .55*noise3(p)+.28*noise3(p*2.02+6.4)+.17*noise3(p*4.03-4.6);}
float sdBox(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
float sdCyl(vec3 p,float radius,float halfH){vec2 q=abs(vec2(length(p.xz),p.y))-vec2(radius,halfH);return min(max(q.x,q.y),0.)+length(max(q,0.));}
float sdRing(vec3 p,float outerR,float innerR,float h){return max(sdCyl(p,outerR,h),-sdCyl(p,innerR,h+0.01));}
vec2 closer(vec2 a,vec2 b){return a.x<b.x?a:b;}

// Precision-machined conceptual optical chamber. Not a NASA hardware replica.
vec2 sceneSDF(vec3 p){
 vec2 r=vec2(p.y+.52,1.);
 r=closer(r,vec2(sdCyl(p-vec3(0,-.34,0),1.05,.17),2.));
 r=closer(r,vec2(sdRing(p-vec3(0,-.15,0),1.10,.88,.055),3.));
 r=closer(r,vec2(sdRing(p-vec3(0,-.08,0),1.015,.91,.017),4.));
 r=closer(r,vec2(sdRing(p-vec3(0,2.00,0),1.10,.90,.055),3.));
 r=closer(r,vec2(sdRing(p-vec3(0,2.065,0),1.045,.94,.025),4.));
 // Back posts keep the optical window unobstructed.
 for(int i=0;i<2;i++){
   float x=(float(i)*2.-1.)*.76;
   r=closer(r,vec2(sdCyl(p-vec3(x,.94,-.68),.027,1.06),3.));
   r=closer(r,vec2(sdCyl(p-vec3(x,-.20,-.68),.07,.035),4.));
   r=closer(r,vec2(sdCyl(p-vec3(x,2.08,-.68),.047,.025),3.));
 }
 // Repeated bolts in the lower flange, with a recessed hex-like slot.
 vec3 bp=p;float ang=atan(p.z,p.x);float sec=2.*PI/10.;float a=mod(ang+sec*.5,sec)-sec*.5;
 bp.xz=vec2(cos(a),sin(a))*length(p.xz)-vec2(.99,0.);
 float screw=sdCyl(bp-vec3(0,-.085,0),.038,.018);
 screw=max(screw,-sdBox(bp-vec3(0,-.067,0),vec3(.023,.008,.004)));
 r=closer(r,vec2(screw,4.));
 // Specimen stage and ceramic wick holder.
 r=closer(r,vec2(sdCyl(p-vec3(0,-.03,0),.38,.06),3.));
 r=closer(r,vec2(sdCyl(p-vec3(0,.08,0),.16,.07),5.));
 if(uFuel<.5){
   r=closer(r,vec2(sdCyl(p-vec3(0,.195,0),.018,.065),6.));
 }else{
   r=closer(r,vec2(sdBox(p-vec3(0,.18,0),vec3(.25,.018,.14)),5.));
   r=closer(r,vec2(sdBox(p-vec3(-.22,.135,0),vec3(.035,.07,.18)),3.));
   r=closer(r,vec2(sdBox(p-vec3(.22,.135,0),vec3(.035,.07,.18)),3.));
 }
 return r;
}
vec3 normalAt(vec3 p){const float e=.001;vec2 k=vec2(1.,-1.);return normalize(k.xyy*sceneSDF(p+k.xyy*e).x+k.yyx*sceneSDF(p+k.yyx*e).x+k.yxy*sceneSDF(p+k.yxy*e).x+k.xxx*sceneSDF(p+k.xxx*e).x);}
float ambientOcc(vec3 p,vec3 n){float ao=0.,scale=1.;for(int i=1;i<5;i++){float h=.035*float(i);ao+=(h-sceneSDF(p+n*h).x)*scale;scale*=.65;}return clamp(1.-ao*3.,0.,1.);}
vec3 environment(vec3 r){
 vec3 c=mix(vec3(.008,.009,.011),vec3(.11,.12,.13),smoothstep(-.2,.9,r.y));
 c+=vec3(1.15,1.20,1.30)*pow(max(0.,dot(r,normalize(vec3(-2.,2.,1.5)))),45.);
 c+=vec3(.7,.73,.8)*pow(max(0.,dot(r,normalize(vec3(3.,.9,-1.)))),70.);
 c+=vec3(.35,.36,.4)*pow(max(0.,dot(r,normalize(vec3(0.,3.,-3.)))),50.);
 c+=vec3(.95)*exp(-pow((r.x+.52)/.055,2.))*smoothstep(-.2,.65,r.y);
 c+=vec3(.65)*exp(-pow((r.x-.70)/.045,2.))*smoothstep(-.1,.7,r.y);
 return c;
}
float glowSource(vec3 p,float g){return exp(-length((p-vec3(0,.72,0))*vec3(1.8,1.,1.8))*1.8);}
vec3 shade(vec3 p,vec3 rd,float mat,float g){
 vec3 n=normalAt(p);vec3 view=-rd;
 vec3 light=normalize(vec3(-3.,4.,3.));
 vec3 halfV=normalize(light+view);
 float ndl=max(dot(n,light),0.);
 float ao=ambientOcc(p,n);
 vec3 color;float rough,metal;
 if(mat<1.5){color=vec3(.012,.013,.015);rough=.9;metal=.1;}
 else if(mat<2.5){color=vec3(.075,.079,.084);rough=.4;metal=.75;}
 else if(mat<3.5){color=vec3(.53,.55,.57);rough=.23;metal=.9;}
 else if(mat<4.5){color=vec3(.64,.65,.67);rough=.18;metal=.95;}
 else if(mat<5.5){color=vec3(.22,.23,.24);rough=.85;metal=.03;}
 else{color=vec3(.07,.05,.035);rough=.9;metal=0.;}
 // Fine brushed finish on machined surfaces, not color noise on the flame.
 if(mat>1.5 && mat<4.5){float grain=sin(p.y*440.)*.006;color+=grain;}
 vec3 env=environment(reflect(rd,n));
 float fres=pow(1.-max(dot(n,view),0.),5.);
 vec3 spec=mix(vec3(.04),color,metal);
 float shin=mix(12.,160.,1.-rough);
 vec3 outC=color*(.13+.65*ndl)*ao*(1.-metal*.6);
 outC+=env*(spec+(1.-spec)*fres)*(.7-rough*.25)*ao;
 outC+=spec*pow(max(dot(n,halfV),0.),shin)*(2.5-rough)*ao;
 vec3 flameC=mix(vec3(.16,.35,1.),vec3(1.,.30,.045),smoothstep(.05,.8,g));
 outC+=flameC*glowSource(p,g)*max(dot(n,normalize(vec3(0,.65,0)-p)),0.)*.6;
 if(mat>5.5)outC+=vec3(.9,.10,.005)*smoothstep(.16,.27,p.y);
 return outC;
}
vec2 rayBox(vec3 ro,vec3 rd,vec3 lo,vec3 hi){vec3 inv=1./rd;vec3 a=(lo-ro)*inv,b=(hi-ro)*inv;vec3 mn=min(a,b),mx=max(a,b);return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));}

// An artistic radiance field. Time advects turbulence, not measured chemistry.
// No buoyant advection is added at g=0; imposed ventilation acts independently.
vec4 flameVolume(vec3 p,float g){
 float t=uTime;
 float oxy=clamp((uOxygen-12.)/18.,.12,1.25);
 float pressureScale=clamp(sqrt(uPressure/101.3),.72,1.2);
 vec3 q=p-vec3(0,.23,0);
 float h=mix(.66,1.48,pow(g,.5));
 h*=mix(.90,1.10,oxy);
 float y=q.y/h;
 float phase=t*(.25+g*.75);
 float flowShift=uFlow*.040*pow(max(y,0.),1.20);
 q.x-=flowShift;
 // G-dependent advection vanishes exactly at zero gravity. Slow oscillation remains.
 vec3 adv=vec3(q.x*5.5-t*uFlow*.055,q.y*5.5-t*g*1.75,q.z*5.5);
 float n=fbm(adv+vec3(sin(t*.53)*.16,0,cos(t*.41)*.14));
 float w=sin(y*7.-phase*5.)*.070*g+sin(y*14.+phase*2.)*.020*g;
 q.x+=w*max(y,0.);
 q.z+=sin(y*12.+phase*3.)*.018*g*max(y,0.);
 float r=length(q.xz);
 float shape;
 float sphereR=.43*mix(.9,1.04,oxy);
 // Quiescent microgravity: a rounded luminous envelope, not an upward particle fountain.
 vec3 sph=q-vec3(0,.27,0);
 if(uFuel>.5){sph=vec3(q.x*.8,(q.y-.16)*1.2,q.z*1.5);}
 sph.x/=1.+uFlow*.020;
 float sphere=length(sph)/sphereR;
 float width=(.21*pow(max(1.-y,0.),.85)+.006)*sqrt(max(y,0.)*5.+.04);
 width*=pressureScale;
 float plume=r/max(width,.01);
 shape=mix(sphere,plume,smoothstep(0.,.60,g));
 float perturb=(n-.5)*mix(.14,.55,g)*smoothstep(.0,.6,y+.25);
 float boundary=shape+perturb;
 float mask=(1.-smoothstep(.80,1.20,boundary));
 float heightMask=mix(1.,smoothstep(-.03,.03,y)*(1.-smoothstep(.90,1.02,y)),smoothstep(.02,.7,g));
 // Keep the wick/plate attachment visible and the core optically hollow.
 float shell=exp(-pow((boundary-.87)*8.5,2.));
 float hollow=smoothstep(.25,.75,boundary);
 float density=mix(shell*.62,mask*(.02+.98*hollow),smoothstep(.02,.7,g))*heightMask;
 float hot=1.-clamp(boundary*.68+y*.15,0.,1.);
 float fine=noise3(adv*2.7+vec3(0,-t*g*1.5,0));
 density*=.72+fine*.48;
 float chemBase=(1.-smoothstep(.015,.07,q.y))*.85;
 vec3 warm=mix(vec3(1.6,.055,.002),vec3(2.4,.74,.05),smoothstep(.1,.78,hot));
 warm=mix(warm,vec3(2.8,1.6,.46),pow(hot,4.)*.75);
 warm=mix(warm,vec3(.10,.21,1.8),chemBase);
 vec3 blue=mix(vec3(.003,.012,.05),vec3(.015,.09,.55),smoothstep(.35,.95,boundary));
 blue+=vec3(.025,.07,.18)*pow(max(0.,1.-abs(boundary-.91)*5.),3.)*.28;
 float regime=smoothstep(.02,.7,g);
 vec3 emission=mix(blue,warm,regime);
 density*=mix(1.1,2.5,regime);
 if(uFuel>.5){density*=1.-smoothstep(.95,1.2,abs(q.x)*2.);}
 return vec4(emission*density,density);
}
vec3 volumeIntegrate(vec3 ro,vec3 rd,float maxT,float g,vec3 behind){
 vec2 b=rayBox(ro,rd,vec3(-.95,-.02,-.8),vec3(1.6,2.02,.8));
 float t=max(b.x,0.);float endT=min(b.y,maxT);
 if(endT<=t)return behind;
 float stepS=(endT-t)/48.;
 t+=stepS*hash31(vec3(gl_FragCoord.xy,fract(uTime*.1)));
 vec3 light=vec3(0.);float trans=1.;
 for(int i=0;i<48;i++){
  vec3 p=ro+rd*t;
  vec4 f=flameVolume(p,g);
  float opacity=1.-exp(-f.a*stepS*2.6);
  light+=trans*f.rgb*stepS*2.7;
  trans*=1.-opacity*.38;
  t+=stepS;
 }
 return behind*trans+light;
}
vec3 glassPass(vec3 ro,vec3 rd,float hitT,vec3 c){
 float A=dot(rd.xz,rd.xz),B=2.*dot(ro.xz,rd.xz),C=dot(ro.xz,ro.xz)-.98*.98;
 float d=B*B-4.*A*C;if(d<0.)return c;
 float t=(-B-sqrt(d))/(2.*A);vec3 p=ro+rd*t;
 if(t>0. && t<hitT && p.y>-.08 && p.y<1.98){
  vec3 n=normalize(vec3(p.x,0,p.z));
  float f=.025+.20*pow(1.-abs(dot(-rd,n)),4.);
  c=mix(c,environment(reflect(rd,n)),f);
  // Narrow reflections from photographic strip lights on clear glass.
  vec3 rr=reflect(rd,n);
  float strip=pow(max(dot(rr,normalize(vec3(-2.,1.,2.))),0.),150.);
  c+=vec3(.25)*strip;
 }
 return c;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){
 vec2 frag=gl_FragCoord.xy;
 vec2 res=uResolution;
 float g=uGravity;
 if(uSplit>.5){if(frag.x<res.x*.5)g=1.;else{g=0.;frag.x-=res.x*.5;}res.x*=.5;}
 vec2 uv=(frag*2.-res)/res.y;
 float yaw=uYaw;
 vec3 target=vec3(0,.79,0);
 float fitted=max(uSplit>.5?4.725:4.5,2.30/(res.x/res.y));
 float dist=fitted*(uZoom/4.5);
 vec3 ro=target+vec3(sin(yaw)*cos(uPitch),sin(uPitch),cos(yaw)*cos(uPitch))*dist;
 vec3 ww=normalize(target-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
 vec3 rd=normalize(uv.x*uu+uv.y*vv+ww*1.72);
 float t=.02;float material=0.;bool hit=false;
 for(int i=0;i<100;i++){
  vec2 h=sceneSDF(ro+rd*t);
  if(h.x<.0012){hit=true;material=h.y;break;}
  t+=h.x*.85;
  if(t>18.)break;
 }
 vec3 bg=vec3(.003,.0032,.004)+vec3(.008,.0085,.010)*exp(-dot(uv*vec2(.7,1.),uv*vec2(.7,1.))*.9);
 vec3 c=hit?shade(ro+rd*t,rd,material,g):bg;
 if(hit && material<1.5)c=mix(bg,c,exp(-pow(t/7.,2.)));
 c=volumeIntegrate(ro,rd,hit?t:18.,g,c);
 c=glassPass(ro,rd,hit?t:18.,c);
 // Flow tracers are opt-in, labelled conceptual in the UI.
 if(uTransport>.5){
  vec2 bb=rayBox(ro,rd,vec3(-.9,.1,-.6),vec3(.9,1.6,.6));
  float planeT=(-.28-ro.z)/rd.z;vec3 p=ro+rd*planeT;
  if(planeT>0. && planeT<t && abs(p.x)<.88 && p.y>.24 && p.y<1.65){
   float yy=p.y-(g*.11)*smoothstep(-.2,.6,p.x);
   float line=1.-smoothstep(.0,.006,abs(mod(yy,.22)-.11));
   float speed=uFlow*.14;
   float dash=step(.65,fract(p.x*2.5-uTime*speed));
   float vis=clamp(uFlow/5.,0.,1.);
   c+=vec3(.13,.16,.19)*line*dash*vis;
  }
 }
 c=aces(c*1.25);
 c=pow(c,vec3(1./2.2));
 c*=1.-.18*dot(uv*.5,uv*.5);
 gl_FragColor=vec4(c,1.);
}
