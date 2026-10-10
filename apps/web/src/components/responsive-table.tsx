import type { ReactNode } from "react";

export type TableColumn<T> = {
  key: string;
  label: string;
  render(row: T): ReactNode;
};

/** Desktop rows and phone cards share the same data and permitted actions. */
export function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey(row: T): string;
  caption: string;
}) {
  return (
    <div className="responsive-data">
      <div className="table-scroll desktop-data">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mobile-data" aria-label={caption}>
        {rows.map((row) => (
          <li className="data-card" key={rowKey(row)}>
            <h3>{columns[0]?.render(row)}</h3>
            <dl>
              {columns.slice(1).map((column) => (
                <div key={column.key}>
                  <dt>{column.label}</dt>
                  <dd>{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
