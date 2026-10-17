# Rewrites C2 of formula-no-cache.xlsx to the openpyxl form <c r="C2"><f>B2*2</f></c> (no type, no cached value).
import sys, zipfile, shutil
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'xl/worksheets/sheet1.xml':
            s = data.decode('utf-8')
            before = '<c r="C2" t="e"><f>B2*2</f></c>'
            assert before in s, 'pattern not found'
            s = s.replace(before, '<c r="C2"><f>B2*2</f></c>')
            data = s.encode('utf-8')
        zout.writestr(item, data)
print('patched')
