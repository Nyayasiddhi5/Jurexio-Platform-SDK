export default function LivePreview({ children, ...props }: any) {
  return <div className="p-4" {...props}>{children || 'LivePreview'}</div>;
}
