"""Run second-pass diagnostics against two reconciliation workbooks."""

from workbook_compare_tools import build_parser, run_second_pass


def parse_args():
    """Parse command-line arguments for the second-pass comparison."""
    return build_parser(
        'Run second-pass diagnostics against two workbooks using the expected Error Report layouts.'
    ).parse_args()


def main():
    """Print category, coverage, and exposure diagnostics."""
    args = parse_args()
    run_second_pass(args.baseline, args.candidate)


if __name__ == '__main__':
    main()
