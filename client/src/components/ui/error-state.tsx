/**
 * Canonical ErrorState component (task-180/B5).
 * Lives under ui/ alongside <Skeleton> so all shared state-views are colocated.
 * Implementation is delegated to the brand-aligned JrxErrorState.
 */
export { JrxErrorState as ErrorState, type JrxErrorStateProps as ErrorStateProps } from '@/components/JrxErrorState';
export { JrxErrorState as default } from '@/components/JrxErrorState';
