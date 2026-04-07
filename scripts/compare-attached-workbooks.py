"""Compare two generated reconciliation workbooks for parity diagnostics."""

from workbook_compare_tools import build_parser, run_row_compare


def parse_args():
    """Parse command-line arguments for workbook comparison."""
    return build_parser(
        'Compare two attached reconciliation workbooks with summary and row-level diagnostics.'
    ).parse_args()


def main():
    """Compare workbook summaries, error categories, and row-level deltas."""
    args = parse_args()
    run_row_compare(args.baseline, args.candidate)


if __name__ == '__main__':
    main()
