# Analyse sampled snapshots: fix interval, age, speed, and error of today's guess (aheadM, capped at path end).
# Research only (docs/research/realistic-motion.md). Samples: one JSON per fetch, named <name>_<unix>.json:
#   for i in $(seq 1 21); do curl -s https://transit.haroldpoi.dev/v1/vehicles -o v_$(date +%s).json; sleep 30; done
#   python3 realistic-motion-analyse.py 'v_*.json'
import json,glob,math,sys,collections
def hav(a,b):
    R=6371000;p1,p2=math.radians(a[0]),math.radians(b[0]);dl=math.radians(b[1]-a[1]);dp=p2-p1
    return 2*R*math.asin(math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))
def plen(p): return sum(hav(p[i-1],p[i]) for i in range(1,len(p)))
def ahead(v,dt): dt=min(max(dt,0),150); return v*60*(1-math.exp(-dt/60))
def q(xs,ps=(10,50,90)):
    xs=sorted(xs); n=len(xs)
    return [round(xs[min(n-1,int(p*n/100))],1) for p in ps] if n else None
pat=sys.argv[1]
fx=collections.defaultdict(dict)   # veh -> position_at -> (fetched, rec)
for f in sorted(glob.glob(pat)):
    t=int(f.rsplit('_',1)[1][:-5])
    try: d=json.load(open(f))
    except Exception: continue
    for v in d.get('vehicles',[]):
        k=v.get('line','')+'/'+v['id']
        if v['position_at'] not in fx[k]: fx[k][v['position_at']]=(t,v)
capped=[];nodecay=[];gaps=[];firstage=[];err=[];errnull=[];moved=[];cmp_=[]
for k,m in fx.items():
    ts=sorted(m)
    for a,b in zip(ts,ts[1:]):
        gaps.append(b-a)
        va=m[a][1]; vb=m[b][1]; d=hav((va['lat'],va['lon']),(vb['lat'],vb['lon']))
        if b-a>300: continue
        moved.append(d/(b-a))
        if va['speed'] is None: errnull.append(d); continue
        # straight-line distance as proxy for along-route distance (short gaps)
        g=ahead(va['speed'],b-a)
        if va['path']: g=min(g,plen(va['path']))
        else: g=0
        err.append(g-d)
        capped.append(va['path'] is not None and ahead(va['speed'],b-a)>plen(va['path'])+1)
        nodecay.append(va['speed']*min(b-a,150)-d)
        if b-a>=20: cmp_.append((va['speed'], d/(b-a)))
    for a in ts: firstage.append(m[a][0]-a)
print('vehicles',len(fx),'fix pairs',len(gaps))
print('interval between new fixes s p10/50/90',q(gaps))
print('age when first seen s p10/50/90',q(firstage))
print('observed speed between fixes m/s p10/50/90',q(moved))
print('guess-minus-real metres p10/50/90',q(err),'n',len(err),' |err| p50/p90',q([abs(e) for e in err],(50,90)))
print('real move when speed null m p50/p90',q(errnull,(50,90)),'n',len(errnull))
print('share guess ahead of real (>25m)',round(sum(e>25 for e in err)/max(1,len(err)),2),'behind (<-25m)',round(sum(e<-25 for e in err)/max(1,len(err)),2))
print('share where path end (next stop) cut the guess',round(sum(capped)/max(1,len(capped)),2))
print('no decay, no cap: guess-minus-real p10/50/90',q(nodecay))
# Variants on the same fix pairs (straight-line real move; guesses along route).
def run(name,fn):
    e=[]
    for k,m in fx.items():
        ts=sorted(m)
        for a,b in zip(ts,ts[1:]):
            va,vb=m[a][1],m[b][1]
            if b-a>300 or va['speed'] is None: continue
            d=hav((va['lat'],va['lon']),(vb['lat'],vb['lon']))
            e.append(fn(va,b-a)-d)
    if e: print(f'{name:38s} p10/50/90 {q(e)}  |e| p50/p90 {q([abs(x) for x in e],(50,90))}  ahead>50m {round(sum(x>50 for x in e)/len(e),2)}')
pl=lambda v: plen(v['path']) if v['path'] else 0
run('today: decay60 + cap next stop', lambda v,dt: min(ahead(v['speed'],dt), pl(v)))
run('const speed + cap next stop', lambda v,dt: min(v['speed']*min(dt,150), pl(v)))
run('const speed, no cap', lambda v,dt: v['speed']*min(dt,150))
run('0.8 x speed, no cap', lambda v,dt: 0.8*v['speed']*min(dt,150))
run('standing (no motion)', lambda v,dt: 0)
st=[];cnt=0
for k,m in fx.items():
    ts=sorted(m)
    for a,b in zip(ts,ts[1:]):
        if b-a>300: continue
        va,vb=m[a][1],m[b][1]; cnt+=1
        st.append(hav((va['lat'],va['lon']),(vb['lat'],vb['lon']))<20)
print('share of fix pairs standing (<20 m)',round(sum(st)/max(1,cnt),2))
