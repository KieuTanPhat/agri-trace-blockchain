import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { ReactNode } from "react";
import { EmptyState } from "./states";

export type Column<T> = {
  header: ReactNode;
  cell(row: T): ReactNode;
  /** Optional class for both the header and the cells of the column. */
  className?: string;
};

/**
 * Scrollable table with a shared look; below 600 px each row becomes a card
 * whose middle cells are labelled by the column headers.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  empty,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey(row: T): string;
  /** Shown instead of the table once rows are loaded and none match. */
  empty?: { title: string; description: string };
}) {
  if (rows && !rows.length && empty) return <EmptyState {...empty} />;
  return (
    <div className="manage-table-scroll">
      <Table className="manage-table" aria-label={label}>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead className={column.className} key={index} scope="col">
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column, index) => (
                <TableCell
                  className={column.className}
                  key={index}
                  data-label={
                    typeof column.header === "string"
                      ? column.header
                      : undefined
                  }
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
