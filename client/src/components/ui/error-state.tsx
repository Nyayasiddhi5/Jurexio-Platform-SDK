/**
 * Canonical ErrorState component (task-180/B5).
 * Lives under ui/ alongside <Skeleton> so all shared state-views are colocated.
 * Implementation is delegated to the brand-aligned NyvErrorState.
 */
export { NyvErrorState as ErrorState, type NyvErrorStateProps as ErrorStateProps } from '@/components/NyvErrorState';
export { NyvErrorState as default } from '@/components/NyvErrorState';
