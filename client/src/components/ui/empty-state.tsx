/**
 * Canonical EmptyState component (task-180/B5).
 * Lives under ui/ alongside <Skeleton> so all shared state-views are colocated.
 * Implementation is delegated to the brand-aligned NyvEmptyState — this file
 * is the import path consumers should use going forward.
 */
export { NyvEmptyState as EmptyState, type NyvEmptyStateProps as EmptyStateProps } from '@/components/NyvEmptyState';
export { NyvEmptyState as default } from '@/components/NyvEmptyState';
