export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(10,42,102,0.05), rgba(10,42,102,0.1))' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: '#152448' }}></div>
        <p className="text-sm" style={{ color: '#152448' }}>{message || 'Loading platform...'}</p>
      </div>
    </div>
  );
}

export default LoadingSpinner;
