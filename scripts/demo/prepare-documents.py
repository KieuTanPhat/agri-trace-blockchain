"""Create conspicuously fictional supporting documents for the local seed only."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pypdf import PdfReader
import subprocess
import sys

target = Path(__file__).with_name('assets')
target.mkdir(parents=True, exist_ok=True)
output = target / 'demo-documents.pdf'
c = canvas.Canvas(str(output), pagesize=(595, 842))
c.setTitle('AgriTrace DEMO supporting documents - no legal validity')
documents = [
    ('LAND_CERTIFICATE', 'Demo land-use information', ['Area: 12,000 square metres; two plots of 6,000 square metres.', 'Use: crop production in the fictional AgriTrace sample dataset.', 'No ownership, tenure or land rights are certified by this document.']),
    ('PRODUCTION_CONTRACT', 'Demo production agreement', ['Parties: fictional producer, processor, carrier and distributor.', 'Scope: traceable fresh produce; harvest by lot, refrigerated transport.', 'Delivery quantities and custody are recorded by application commands.', 'This document creates no contract, liability or payment obligation.']),
    ('QUALITY_CERTIFICATE', 'Demo quality-process statement', ['Controls illustrated: incoming inspection, hygiene and cold storage.', 'Records: care diary, harvest photographs and independent demo review.', 'No VietGAP, organic, food-safety or other real certification is claimed.']),
]
for code, title, paragraphs in documents:
    c.setFillColor(HexColor('#134d35')); c.rect(0, 736, 595, 106, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1); c.setFont('Helvetica-Bold', 24); c.drawString(44, 784, 'AGRITRACE / DEMO')
    c.setFont('Helvetica', 12); c.drawString(44, 756, 'Fictional local dataset - supporting record')
    c.setFillColor(HexColor('#b45309')); c.setFont('Helvetica-Bold', 18); c.drawString(44, 691, 'DEMO - NO LEGAL VALIDITY')
    c.setFillColor(HexColor('#18382b')); c.setFont('Helvetica-Bold', 17); c.drawString(44, 646, title)
    c.setFont('Helvetica', 11); y = 602
    for line in [f'Record category: {code}', 'Dataset date: 20 October 2026', 'Purpose: demonstrate document fields and approval workflows.', '', *paragraphs]:
        c.drawString(44, y, line); y -= 25
    c.setFillColor(HexColor('#fef3c7')); c.rect(44, 154, 507, 108, fill=1, stroke=0)
    c.setFillColor(HexColor('#92400e')); c.setFont('Helvetica-Bold', 12); c.drawString(60, 229, 'NOT AN OFFICIAL DOCUMENT')
    c.setFont('Helvetica', 10)
    for i, line in enumerate(['No official seal, signature or authority is represented.', 'All entities and administrative identifiers in the seed are fictional.', 'Photographs in the demo are licensed stock illustrations.']): c.drawString(60, 206 - 17 * i, line)
    c.setFillColor(HexColor('#64748b')); c.setFont('Helvetica', 9); c.drawString(44, 58, 'AgriTrace seed sample / never use as compliance or ownership evidence')
    c.showPage()
c.save()
pdf = PdfReader(output)
assert len(pdf.pages) == 3
for page in pdf.pages:
    assert 'NO LEGAL VALIDITY' in page.extract_text()
subprocess.run([sys.argv[1] if len(sys.argv) > 1 else 'pdftoppm', '-jpeg', '-scale-to', '1400', str(output), str(target / 'rendered')], check=True, capture_output=True)
for i, (code, _, _) in enumerate(documents, 1):
    (target / f'rendered-{i}.jpg').replace(target / f'demo-{code}.jpg')
print('Created and rendered 3 explicitly fictional supporting documents.')
