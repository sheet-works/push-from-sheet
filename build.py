# Builds the files to paste into Apps Script from the tested pieces, and prints each one's size and check number.
#   'SHARE - paste into the sheet's Apps Script.gs' = the sheet we share (the script lives inside the sheet)
# Run:  python3 build.py
import os, json
here = os.path.dirname(os.path.abspath(__file__))
PAGE = '(the page files)'
CORE = ['es256.js', 'push.js', 'hub.js', 'lock.js', 'engine.js', 'setup.js', 'png.js', 'qr.js', 'steps.js', 'setuptab.js', 'menu.js', 'phonetab.js',
        'stage3-apps-script.js', 'run-apps-script.js', 'draw-setup-apps-script.js', 'setuprun-apps-script.js', 'menu-apps-script.js', PAGE]
BUILDS = [("SHARE - paste into the sheet's Apps Script.gs", CORE + ['env-share-apps-script.js'])]

# The sign-up page travels inside the script (Set up uploads it to the owner's own Firebase site). One truth: the
# files in stage3/ - this piece is made from them on every build, never edited by hand.
def page_files():
    files = {name: open(os.path.join(here, 'stage3', name), encoding='utf8').read() for name in ['index.html', 'sw.js']}
    return ('// The sign-up page and its worker (made by build.py from stage3/index.html and stage3/sw.js - do not edit here).\n'
            'var PFS_PAGE_FILES = ' + json.dumps(files, ensure_ascii=True) + ';\n')

def check_number(s):
    x = 0
    for c in s:
        x = (x * 31 + ord(c)) & 0xFFFFFFFF
    return x

for out, pieces in BUILDS:
    whole = ''.join(page_files() if f == PAGE else open(os.path.join(here, f), encoding='utf8').read() for f in pieces)
    # A stamp of this exact code, so Set up publishes the web app again whenever the pasted code changes (18 Nov).
    whole += "\n// Build stamp (made by build.py from everything above).\nvar PFS_BUILD = '%d';\n" % check_number(whole)
    open(os.path.join(here, out), 'w', encoding='utf8').write(whole)
    print('built', out, '-', len(whole), 'characters, check number', check_number(whole))
