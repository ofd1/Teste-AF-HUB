import cv2, numpy as np, sys
S=sys.argv[1]; I='/tmp/claude-0/-home-user-Teste-AF-HUB/057ddbee-becf-5539-a2b6-ea10f76c117f/images'
a=cv2.imread(I+'/1.webp'); b=cv2.imread(I+'/2.webp')
M=np.load(S+'/tzc/M.npy').astype(np.float32)
up=cv2.warpAffine(b,M,(a.shape[1],a.shape[0]),flags=cv2.INTER_LINEAR)
# refina o alinhamento (ECC, afim) em escala de cinza
ga=cv2.cvtColor(a,6).astype(np.float32)/255; gu=cv2.cvtColor(up,6).astype(np.float32)/255
W=np.eye(2,3,dtype=np.float32)
cc,W=cv2.findTransformECC(cv2.GaussianBlur(ga,(0,0),1.5),cv2.GaussianBlur(gu,(0,0),1.5),W,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),None,5)
print('ECC',cc,W)
# W mapeia a -> up; warpamos up para a
up2=cv2.warpAffine(up,W,(a.shape[1],a.shape[0]),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP)
mask=cv2.warpAffine(cv2.warpAffine(np.ones(b.shape[:2],np.uint8)*255,M,(a.shape[1],a.shape[0])),W,(a.shape[1],a.shape[0]),flags=cv2.INTER_NEAREST|cv2.WARP_INVERSE_MAP)
mask=cv2.erode(mask,np.ones((9,9)))
np.savez_compressed(S+'/nn/pair.npz',inp=up2,tgt=a,mask=mask)
print(up2.shape, (mask>0).mean())
