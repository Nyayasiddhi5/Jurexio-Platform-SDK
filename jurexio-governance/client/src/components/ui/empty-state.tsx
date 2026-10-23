/**
 * Canonical EmptyState component (task-180/B5).
 * Lives under ui/ alongside <Skeleton> so all shared state-views are colocated.
 * Implementation is delegated to the brand-aligned JrxEmptyState — this file
 * is the import path consumers should use going forward.
 */
export { JrxEmptyState as EmptyState, type JrxEmptyStateProps as EmptyStateProps } from '@/components/JrxEmptyState';
export { JrxEmptyState as default } from '@/components/JrxEmptyState';
