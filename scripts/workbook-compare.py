"""Unified workbook comparison CLI."""

from workbook_compare_tools import (
    build_parser,
    run_parity,
    run_row_compare,
    run_second_pass,
)


def parse_args():
    """Parse arguments for the unified workbook comparison CLI."""
    parser = build_parser(
        'Compare reconciliation workbooks in parity, row, or second-pass mode.'
    )
    parser.add_argument(
        '--mode',
        choices=['parity', 'row', 'second-pass'],
        default='parity',
        help='Comparison mode to run.',
    )
    return parser.parse_args()


def main():
    """Dispatch to the requested workbook comparison mode."""
    args = parse_args()
    if args.mode == 'parity':
        run_parity(args.baseline, args.candidate)
        return
    if args.mode == 'row':
        run_row_compare(args.baseline, args.candidate)
        return
    run_second_pass(args.baseline, args.candidate)


if __name__ == '__main__':
    main()