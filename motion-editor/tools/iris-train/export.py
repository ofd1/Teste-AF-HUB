import torch, json, sys
sd=torch.load(sys.argv[1]); out=sys.argv[2]
layers=[]
for name,dil in [('c1',1),('c2',2),('c3',1),('c4',1)]:
    w=sd[name+'.weight'].numpy().round(5).tolist(); b=sd[name+'.bias'].numpy().round(5).tolist()
    layers.append({'w':w,'b':b,'dil':dil})
js='// Pesos da rede "Iris (aprendido)" — treinada com pares reais original → Topaz Iris do usuário (escala: 1 px do vídeo = 1,6 px).\nexport default '+json.dumps({'scale':1.6,'layers':layers},separators=(',',':'))+';\n'
open(out,'w').write(js); print(len(js))
