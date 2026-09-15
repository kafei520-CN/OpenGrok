---
name: xlsx
description: Create, read, and edit Excel workbooks (.xlsx, .xlsm, .csv, .tsv). Use whenever the user mentions Excel, spreadsheet, workbook, .xlsx, formulas, pivot tables, charts in a sheet, or wants a table delivered as a spreadsheet. Also use for cleaning messy tabular data into a proper workbook.
---

# Excel workbooks

Prefer **openpyxl** for structure, formulas, and formatting. Prefer **pandas** for bulk rows in/out. Do not hardcode calculated totals — write Excel formulas so the sheet recalculates when inputs change.

Install only if import fails:

```bash
pip install openpyxl pandas
```

Helper: `python scripts/recalc.py output.xlsx` (LibreOffice). Run it after writing formulas, then spot-check values.

## Read

```python
import openpyxl
import pandas as pd

# Formulas as strings
wb = openpyxl.load_workbook("data.xlsx", data_only=False)
print(wb.sheetnames)
ws = wb.active
print(ws["A1"].value)

# Cached values (None until Excel/LibreOffice has calculated)
values = openpyxl.load_workbook("data.xlsx", data_only=True)

# Bulk table
df = pd.read_excel("data.xlsx", sheet_name=0)
print(df.head())
```

Never `save()` a `data_only=True` workbook — that replaces formulas with literals.

`.xlsm` macros: `load_workbook(path, keep_vba=True)`.

## Create

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.utils.dataframe import dataframe_to_rows
from openpyxl.comments import Comment

wb = Workbook()
ws = wb.active
ws.title = "Summary"

header_font = Font(name="Calibri", bold=True, color="FFFFFF")
header_fill = PatternFill("solid", fgColor="1F4E79")
thin = Border(
    left=Side(style="thin", color="D9D9D9"),
    right=Side(style="thin", color="D9D9D9"),
    top=Side(style="thin", color="D9D9D9"),
    bottom=Side(style="thin", color="D9D9D9"),
)

headers = ["Month", "Revenue", "Cost", "Profit"]
ws.append(headers)
for cell in ws[1]:
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center")

rows = [
    ("Jan", 120000, 74000),
    ("Feb", 135000, 81000),
    ("Mar", 128000, 79000),
]
for month, rev, cost in rows:
    r = ws.max_row + 1
    ws.cell(r, 1, month)
    ws.cell(r, 2, rev).number_format = '#,##0'
    ws.cell(r, 3, cost).number_format = '#,##0'
    ws.cell(r, 4, f"=B{r}-C{r}").number_format = '#,##0'

last = ws.max_row
total = last + 1
ws.cell(total, 1, "Total").font = Font(bold=True)
ws.cell(total, 2, f"=SUM(B2:B{last})").number_format = '#,##0'
ws.cell(total, 3, f"=SUM(C2:C{last})").number_format = '#,##0'
ws.cell(total, 4, f"=SUM(D2:D{last})").number_format = '#,##0'

for col in range(1, 5):
    letter = get_column_letter(col)
    width = max(len(str(ws.cell(i, col).value or "")) for i in range(1, total + 1))
    ws.column_dimensions[letter].width = min(max(width + 2, 12), 28)

ws.auto_filter.ref = f"A1:D{last}"
ws.freeze_panes = "A2"
ws.cell(2, 2).comment = Comment("Source: user-provided figures", "OpenGrok")

chart = BarChart()
chart.title = "Revenue vs cost"
chart.y_axis.title = None
chart.add_data(Reference(ws, min_col=2, min_row=1, max_col=3, max_row=last), titles_from_data=True)
chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=last))
chart.shape = 4
ws.add_chart(chart, "F2")

ws.conditional_formatting.add(
    f"D2:D{last}",
    ColorScaleRule(start_type="min", start_color="F8696B", end_type="max", end_color="63BE7B"),
)

wb.save("report.xlsx")
```

Sheet names with spaces in formulas must be quoted: `='Assumptions Inputs'!$B$5`.

## Edit in place

```python
wb = openpyxl.load_workbook("report.xlsx")
ws = wb["Summary"]
ws["B2"] = 125000
# keep existing formulas; only change inputs
wb.save("report.xlsx")
```

Write merged ranges only on the top-left cell.

## pandas bulk

```python
import pandas as pd

df = pd.read_csv("export.csv")
with pd.ExcelWriter("clean.xlsx", engine="openpyxl") as writer:
    df.to_excel(writer, sheet_name="Data", index=False)
```

After pandas write, reopen with openpyxl to add formulas, freeze panes, and number formats.

## Recalculate

openpyxl stores formulas as text. Cached values stay empty until Excel or LibreOffice calculates:

```bash
python scripts/recalc.py report.xlsx
```

If LibreOffice is missing, still ship the `.xlsx` (Excel will calculate on open) and say so. Never invent cached numbers.

After recalc, reopen `data_only=True` and check a few formula cells are numbers, not `None` or `#REF!`.

## Formulas that survive

Use `SUM`, `SUMIF`, `SUMIFS`, `IF`, `IFERROR`, `INDEX`, `MATCH`, `AVERAGE`, `COUNTIF`. Avoid `XLOOKUP`, `FILTER`, `UNIQUE`, `SEQUENCE` unless the user will only open the file in current Microsoft Excel.

Percentages: store `0.15`, format `0.0%`. Currency: `#,##0.00`. Dates: `YYYY-MM-DD` cells with `YYYY-MM-DD` format.

## QA before handing the file over

1. Every total is a formula, not a Python result.
2. Header row frozen; columns wide enough; no `#####` clipping.
3. Number formats match the unit in the header (`Revenue (USD)`).
4. One realistic example row if this is a blank template for the user to fill.
5. Recalc (or note that Excel will calc on open) and spot-check 2–3 cells.

## Convert

```python
pd.read_excel("a.xlsx").to_csv("a.csv", index=False)
```

PDF snapshot (if LibreOffice is installed): `python scripts/recalc.py` is convert-to xlsx; for PDF use `soffice --headless --convert-to pdf file.xlsx`.
