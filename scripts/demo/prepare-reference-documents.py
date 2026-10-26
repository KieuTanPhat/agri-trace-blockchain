"""Create irreversible, fully de-identified reference copies; never edit originals."""
from pathlib import Path
import hashlib
import json
import fitz
from PIL import Image
from io import BytesIO

source=Path(r'C:\Users\kieup\Desktop\Data\GiayCHungNhan')
target=Path('.codex/fruit-assets')
target.mkdir(parents=True,exist_ok=True)
records=[]
for index,path in enumerate(sorted(source.iterdir())):
    if not path.is_file(): continue
    if path.suffix.lower()=='.webp':
        converted=BytesIO()
        Image.open(path).convert('RGB').save(converted,format='PNG')
        image=fitz.open(stream=converted.getvalue(),filetype='png')
    else:
        image=fitz.open(path)
    pdf=fitz.open('pdf',image.convert_to_pdf())
    page=pdf[0]
    rect=page.rect
    # Remove ALL original image data, including seals, signatures and identities.
    # No unredacted image is retained underneath a visual overlay in the PDF.
    page.add_redact_annot(rect,fill=(1,1,1))
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)
    w,h=rect.width,rect.height
    page.draw_rect(fitz.Rect(w*.07,h*.05,w*.93,h*.95),color=(.2,.35,.3),width=1)
    page.insert_textbox(fitz.Rect(w*.1,h*.1,w*.9,h*.22),'HO SO THAM KHAO',fontsize=max(9,min(w/19,22)),align=1,color=(.15,.3,.22))
    page.insert_textbox(fitz.Rect(w*.12,h*.28,w*.88,h*.65),f'Ma ho so: HS-{index+1:04d}\n\nBan sao da an toan bo thong tin dinh danh.\n\nTai lieu tham khao bo cuc ho so.\nKhong xac nhan quyen so huu hoac chung nhan chat luong.',fontsize=max(7,min(w/32,13)),align=0)
    name=f'reference-{index+1}'
    pdf.save(target/f'{name}.pdf',garbage=4,deflate=True)
    # Rasterization is document rendering; the original photographs are untouched.
    rendered=fitz.open(target/f'{name}.pdf')
    rendered[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(target/f'{name}.jpg')
    rendered.close()
    if path.name.startswith('chungnhandat'):
        (target/f'land-{path.stem[-1]}.jpg').write_bytes((target/f'{name}.jpg').read_bytes())
    records.append({'source':str(path),'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'reference':f'{name}.pdf','redaction':'all source image data removed'})
    pdf.close();image.close()
(target/'document-manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Prepared {len(records)} de-identified reference documents; originals untouched.')
