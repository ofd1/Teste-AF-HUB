#!/usr/bin/env python3
"""Gera rsrc_windows_amd64.syso (ícone do MotionFrame.exe) a partir de PNGs, sem ferramentas externas.
Uso: python3 make-icon-syso.py saida.syso icon16.png icon32.png icon48.png icon256.png
O Go embute automaticamente arquivos .syso da pasta no executável."""
import struct, sys
from PIL import Image

out, pngs = sys.argv[1], sys.argv[2:]
imgs = [(Image.open(p).size[0], open(p, 'rb').read()) for p in pngs]

# GRPICONDIR + entradas (14 bytes cada); ícones como PNG (aceito pelo Windows Vista+)
grp = struct.pack('<HHH', 0, 1, len(imgs))
for i, (w, data) in enumerate(imgs):
    grp += struct.pack('<BBBBHHIH', w if w < 256 else 0, w if w < 256 else 0, 0, 0, 1, 32, len(data), i + 1)

types = [(3, [(i + 1, d) for i, (_, d) in enumerate(imgs)]), (14, [(1, grp)])]

def dir_hdr(n):
    return struct.pack('<IIHHHH', 0, 0, 0, 0, 0, n)

# layout: raiz, diretórios de tipo, diretórios de nome/idioma, data entries, dados
root_sz = 16 + 8 * len(types)
type_dirs = [16 + 8 * len(items) for _, items in types]
lang_dirs = [[16 + 8 for _ in items] for _, items in types]
off = root_sz
type_off = []
for sz in type_dirs:
    type_off.append(off); off += sz
lang_off = []
for t in lang_dirs:
    row = []
    for sz in t:
        row.append(off); off += sz
    lang_off.append(row)
n_data = sum(len(items) for _, items in types)
data_entry_off = off
off += 16 * n_data
blob_off = []
for _, items in types:
    row = []
    for _, d in items:
        off = (off + 7) & ~7
        row.append(off); off += len(d)
    blob_off.append(row)
total = (off + 7) & ~7

buf = bytearray(total)
relocs = []
buf[0:16] = dir_hdr(len(types))
for k, (tid, _) in enumerate(types):
    struct.pack_into('<II', buf, 16 + 8 * k, tid, 0x80000000 | type_off[k])
de = data_entry_off
for k, (tid, items) in enumerate(types):
    to = type_off[k]
    buf[to:to + 16] = dir_hdr(len(items))
    for j, (nid, d) in enumerate(items):
        struct.pack_into('<II', buf, to + 16 + 8 * j, nid, 0x80000000 | lang_off[k][j])
        lo = lang_off[k][j]
        buf[lo:lo + 16] = dir_hdr(1)
        struct.pack_into('<II', buf, lo + 16, 0x0409, de)
        struct.pack_into('<IIII', buf, de, blob_off[k][j], len(d), 0, 0)
        relocs.append(de)  # OffsetToData é um RVA: o linker soma o endereço da seção
        bo = blob_off[k][j]
        buf[bo:bo + len(d)] = d
        de += 16

# objeto COFF (x64) com uma seção .rsrc, relocações ADDR32NB e o símbolo da seção
raw_ptr = 20 + 40
reloc_ptr = raw_ptr + total
sym_ptr = reloc_ptr + 10 * len(relocs)
coff = struct.pack('<HHIIIHH', 0x8664, 1, 0, sym_ptr, 1, 0, 0)
sect = struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, total, raw_ptr, reloc_ptr, 0, len(relocs), 0, 0x40000040)
rel = b''.join(struct.pack('<IIH', r, 0, 3) for r in relocs)
sym = struct.pack('<8sIhHBB', b'.rsrc', 0, 1, 0, 3, 0)
with open(out, 'wb') as f:
    f.write(coff + sect + bytes(buf) + rel + sym + struct.pack('<I', 4))
print('ok', out, total, 'bytes de recurso,', len(imgs), 'tamanhos')
