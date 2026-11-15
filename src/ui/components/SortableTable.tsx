import { useId, useMemo, useState, type ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => ReactNode;
  isRowHeader?: boolean;
}

const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function SortableTable<T>({
  caption,
  rows,
  columns,
  getRowKey,
  initialSortKey,
  initialSortDir = 'asc',
  emptyMessage = 'No matching rows.',
}: {
  caption: string;
  rows: T[];
  columns: TableColumn<T>[];
  getRowKey: (row: T) => string;
  initialSortKey?: string;
  initialSortDir?: 'asc' | 'desc';
  emptyMessage?: string;
}) {
  const captionId = useId();
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);
  const [statusMessage, setStatusMessage] = useState('');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return rows;
    const getter = col.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = textCollator.compare(String(va), String(vb));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  const handleSort = (col: TableColumn<T>) => {
    if (!col.sortable || !col.sortValue) return;
    const nextDir: 'asc' | 'desc' = sortKey === col.key && sortDir === 'asc' ? 'desc' : 'asc';
    setSortKey(col.key);
    setSortDir(nextDir);
    setStatusMessage(`Sorted ${caption} by ${col.label}, ${nextDir === 'asc' ? 'ascending' : 'descending'}.`);
  };

  return (
    <div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {statusMessage}
      </div>
      <div className="table-wrapper" tabIndex={0} role="region" aria-labelledby={captionId}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((col) => {
                const isActive = sortKey === col.key;
                const ariaSort = isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined;
                return (
                  <th key={col.key} scope="col" {...(ariaSort ? { 'aria-sort': ariaSort } : {})}>
                    {col.sortable && col.sortValue ? (
                      <button type="button" className="sort-btn" onClick={() => handleSort(col)}>
                        <span>{col.label}</span>
                        <span aria-hidden="true">
                          {isActive ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr key={getRowKey(row)}>
                  {columns.map((col) =>
                    col.isRowHeader ? (
                      <th key={col.key} scope="row" className={col.numeric ? 'tabular' : undefined}>
                        {col.render(row)}
                      </th>
                    ) : (
                      <td key={col.key} className={col.numeric ? 'tabular' : undefined}>
                        {col.render(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
