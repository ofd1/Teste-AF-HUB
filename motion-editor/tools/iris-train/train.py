import numpy as np, torch, torch.nn as nn, torch.nn.functional as F, sys, time, json
torch.set_num_threads(4); torch.manual_seed(0); np.random.seed(0)
S=sys.argv[1]; iters=int(sys.argv[2]); C=int(sys.argv[3]) if len(sys.argv)>3 else 16
d=np.load(S+'/nn/pair.npz'); inp=d['inp'][...,::-1].astype(np.float32)/255; tgt=d['tgt'][...,::-1].astype(np.float32)/255; mask=d['mask']>0
H,W,_=inp.shape; split=int(W*0.7)
class Net(nn.Module):
    def __init__(s,C):
        super().__init__()
        s.c1=nn.Conv2d(3,C,3,padding=1); s.c2=nn.Conv2d(C,C,3,padding=2,dilation=2); s.c3=nn.Conv2d(C,C,3,padding=1); s.c4=nn.Conv2d(C,3,3,padding=1)
    def forward(s,x):
        y=F.relu(s.c1(x)); y=F.relu(s.c2(y)); y=F.relu(s.c3(y)); return x+s.c4(y)
net=Net(C); opt=torch.optim.Adam(net.parameters(),2e-3); sched=torch.optim.lr_scheduler.CosineAnnealingLR(opt,iters)
X=torch.from_numpy(inp.copy()).permute(2,0,1); Y=torch.from_numpy(tgt.copy()).permute(2,0,1); Mk=torch.from_numpy(mask.astype(np.float32))
def gk(s):
    r=int(s*3+0.5); x=torch.arange(-r,r+1,dtype=torch.float32); k=torch.exp(-x*x/(2*s*s)); return k/k.sum()
def gblur(t,s):
    k=gk(s); c=t.shape[1]; r=k.numel()//2
    t=F.conv2d(F.pad(t,(r,r,0,0),mode='replicate'),k.view(1,1,1,-1).repeat(c,1,1,1),groups=c)
    return F.conv2d(F.pad(t,(0,0,r,r),mode='replicate'),k.view(1,1,-1,1).repeat(c,1,1,1),groups=c)
def grad(t): return t[...,1:,:]-t[...,:-1,:], t[...,:,1:]-t[...,:,:-1]
P=96; B=16; t0=time.time()
for it in range(iters):
    xs=[];ys=[];ms=[]
    for _ in range(B):
        y0=np.random.randint(0,H-P); x0=np.random.randint(0,split-P)
        x=X[:,y0:y0+P,x0:x0+P]; y=Y[:,y0:y0+P,x0:x0+P]; m=Mk[y0:y0+P,x0:x0+P]
        k=np.random.randint(4); f=np.random.rand()<0.5
        x=torch.rot90(x,k,(1,2)); y=torch.rot90(y,k,(1,2)); m=torch.rot90(m,k,(0,1))
        if f: x=x.flip(2); y=y.flip(2); m=m.flip(1)
        xs.append(x); ys.append(y); ms.append(m)
    x=torch.stack(xs); y=torch.stack(ys); m=torch.stack(ms)[:,None]
    o=net(x)
    # estrutura (baixa frequência) + energia de textura por região (insensível a desalinhamento de 1 px)
    lo=lambda t,s: gblur(t,s)
    l=(m*(lo(o,1.2)-lo(y,1.2)).abs()).mean()*2.0 + (m*(o-y).abs()).mean()*0.3
    for s_ in (0.6,1.2):
        ho=o-lo(o,s_); hy=y-lo(y,s_)
        eo=lo(ho.abs().mean(1,keepdim=True),2.5); ey=lo(hy.abs().mean(1,keepdim=True),2.5)
        l=l+3.0*(m*(eo-ey).abs()).mean()
    opt.zero_grad(); l.backward(); opt.step(); sched.step()
    if it%500==0: print(it, round(l.item(),5), round(time.time()-t0,1), flush=True)
torch.save(net.state_dict(), S+'/nn/net%d.pt'%C)
with torch.no_grad():
    o=net(X[None])[0].clamp(0,1).permute(1,2,0).numpy()
np.save(S+'/nn/out%d.npy'%C,o)
v=slice(split,W)
def l1(a,b): return float(np.abs(a[:,v]-b[:,v])[mask[:,v]].mean())
print('val L1 entrada', round(l1(inp,tgt),5), 'rede', round(l1(o,tgt),5))
