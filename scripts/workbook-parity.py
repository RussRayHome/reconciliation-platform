from openpyxl import load_workbook
from pathlib import Path
from collections import Counter

A = Path('/Users/rray/Desktop/FinancialRecon/BankingRecon/2025_5703_reconciliation_workpaper.xlsx')
B = Path('/Users/rray/Desktop/FinancialRecon/BankingRecon/Account5703Test_recon_workspaper.xlsx')


def sval(v):
    if v is None:
        return ''
    if isinstance(v, float):
        return ('%.10f' % v).rstrip('0').rstrip('.')
    return str(v).strip()


def read_summary(ws):
    d = {}
    max_r = min(ws.max_row, 250)
    for r in range(1, max_r + 1):
        k = sval(ws.cell(r, 1).value)
        v = sval(ws.cell(r, 2).value)
        if k:
            d[k] = v
    return d


def detect_header_row(ws, max_scan=12):
    best_count = -1
    best_row = 1
    for r in range(1, min(ws.max_row, max_scan) + 1):
        non_empty = 0
        for c in range(1, min(ws.max_column, 80) + 1):
            if sval(ws.cell(r, c).value):
                non_empty += 1
        if non_empty > best_count:
            best_count = non_empty
            best_row = r
    return best_row


def read_table(ws):
    hr = detect_header_row(ws)
    idx = []
    headers = []
    for c in range(1, min(ws.max_column, 80) + 1):
        h = sval(ws.cell(hr, c).value)
        if h:
            idx.append(c)
            headers.append(h)

    rows = []
    for r in range(hr + 1, ws.max_row + 1):
        vals = [sval(ws.cell(r, c).value) for c in idx]
        if any(vals):
            rows.append(dict(zip(headers, vals)))
    return hr, headers, rows


def parse_money(value):
    text = sval(value)
    if not text:
        return 0.0

    neg = False
    if text.startswith('(') and text.endswith(')'):
        neg = True
        text = text[1:-1]

    text = text.replace('$', '').replace(',', '').replace(' ', '')
    upper = text.upper()
    if upper.endswith('CR'):
        text = text[:-2]
    if upper.endswith('DR'):
        neg = True
        text = text[:-2]

    try:
        num = float(text)
    except ValueError:
        return 0.0

    if neg:
        return -abs(num)
    return num


def category_counts(rows):
    keys = ['Error Category', 'Category', 'Exception Category', 'Status']
    out = Counter()
    for row in rows:
        cat = ''
        for k in keys:
            if row.get(k):
                cat = row[k]
                break
        if cat:
            out[cat] += 1
    return out


def category_exposure(rows):
    cat_keys = ['Error Category', 'Category', 'Exception Category', 'Status']
    amt_keys = ['Amount', 'Dollar Exposure', 'Exposure']
    out = Counter()
    for row in rows:
        cat = ''
        for k in cat_keys:
            if row.get(k):
                cat = row[k]
                break
        if not cat:
            continue

        amount = 0.0
        for k in amt_keys:
            if row.get(k):
                amount = parse_money(row[k])
                break

        out[cat] += amount
    return out


def print_summary_diff(sa, sb):
    keys = sorted(set(sa) | set(sb))
    diffs = []
    for k in keys:
        av = sa.get(k, '')
        bv = sb.get(k, '')
        if av != bv:
            diffs.append((k, av, bv))

    print(f'SUMMARY_DIFF_COUNT: {len(diffs)}')
    for k, av, bv in diffs:
        print(f'  - {k}: A={av!r} | B={bv!r}')


def main():
    if not A.exists() or not B.exists():
        print('ERROR: workbook path missing')
        print(f'  A exists: {A.exists()} => {A}')
        print(f'  B exists: {B.exists()} => {B}')
        raise SystemExit(1)

    wa = load_workbook(A, data_only=True)
    wb = load_workbook(B, data_only=True)

    print('WORKBOOK_A:', A)
    print('WORKBOOK_B:', B)
    print('')

    print('SHEETS_A:', wa.sheetnames)
    print('SHEETS_B:', wb.sheetnames)
    print('')

    if 'Summary' in wa.sheetnames and 'Summary' in wb.sheetnames:
        sa = read_summary(wa['Summary'])
        sb = read_summary(wb['Summary'])
        print_summary_diff(sa, sb)
    else:
        print('SUMMARY: missing in one of workbooks')
    print('')

    if 'Error Report' in wa.sheetnames and 'Error Report' in wb.sheetnames:
        hra, hda, ra = read_table(wa['Error Report'])
        hrb, hdb, rb = read_table(wb['Error Report'])

        print('ERROR_REPORT:')
        print(f'  A header_row={hra}, rows={len(ra)}, cols={len(hda)}')
        print(f'  B header_row={hrb}, rows={len(rb)}, cols={len(hdb)}')

        ca = category_counts(ra)
        cb = category_counts(rb)
        cats = sorted(set(ca) | set(cb))
        print('  CATEGORY_COUNT_DELTA:')
        for cat in cats:
            av = ca.get(cat, 0)
            bv = cb.get(cat, 0)
            if av != bv:
                print(f'    - {cat}: A={av}, B={bv}, delta={bv - av}')

        da = category_exposure(ra)
        db = category_exposure(rb)
        print('  CATEGORY_EXPOSURE_DELTA:')
        for cat in cats:
            av = round(da.get(cat, 0.0), 2)
            bv = round(db.get(cat, 0.0), 2)
            if av != bv:
                print(f'    - {cat}: A={av}, B={bv}, delta={round(bv - av, 2)}')
    else:
        print('ERROR_REPORT: missing in one of workbooks')

    print('')
    for sheet in ['Mapping and Assumptions', 'Probable Matches Review', 'Reviewer Observations']:
        if sheet in wa.sheetnames and sheet in wb.sheetnames:
            a = wa[sheet]
            b = wb[sheet]
            print(f'{sheet}: A rows={a.max_row}, B rows={b.max_row}, A cols={a.max_column}, B cols={b.max_column}')


if __name__ == '__main__':
    main()
