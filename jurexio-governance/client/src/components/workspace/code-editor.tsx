export default function CodeEditor({ children, ...props }: any) {
  return <div className="p-4" {...props}>{children || 'CodeEditor'}</div>;
}
