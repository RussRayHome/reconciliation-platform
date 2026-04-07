"""Compare reconciliation workbooks at the summary and error-report levels."""

from workbook_compare_tools import build_parser, run_parity


def parse_args():
    """Parse command-line arguments for workbook parity checks."""
    return build_parser(
        'Compare two reconciliation workbooks at the summary and error-report level.'
    ).parse_args()


def main():
    """Compare workbook structure, summary values, and category deltas."""
    args = parse_args()
    run_parity(args.baseline, args.candidate)


if __name__ == '__main__':
    main()
