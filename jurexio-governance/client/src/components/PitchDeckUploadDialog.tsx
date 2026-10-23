import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, X, CheckCircle } from 'lucide-react';

interface PitchDeckUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorName: string;
  onSubmit: (data: { message: string; pitchDeckUrl?: string }) => void;
  isPending: boolean;
}

export function PitchDeckUploadDialog({
  open,
  onOpenChange,
  investorName,
  onSubmit,
  isPending,
}: PitchDeckUploadDialogProps) {
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 50 * 1024 * 1024) {
        toast({
          title: 'File Too Large',
          description: 'Please select a file smaller than 50MB',
          variant: 'destructive',
        });
        return;
      }
      
      const validTypes = [
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ];
      
      if (!validTypes.includes(selectedFile.type)) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select a PDF or PowerPoint file',
          variant: 'destructive',
        });
        return;
      }
      
      setFile(selectedFile);
    }
  };

  const uploadFile = async (file: File): Promise<string> => {
    try {
      setIsUploading(true);
      setUploadProgress(0);

      const chunkSize = 5 * 1024 * 1024;
      const totalChunks = Math.ceil(file.size / chunkSize);

      const initiateResponse = await fetch('/api/files/upload/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          startupId: 1,
        }),
      });

      if (!initiateResponse.ok) throw new Error('Failed to initiate upload');
      const { upload } = await initiateResponse.json();

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append('uploadId', upload.uploadId);
        formData.append('chunkIndex', i.toString());
        formData.append('chunk', chunk);

        const chunkResponse = await fetch('/api/files/upload/chunk', {
          method: 'POST',
          body: formData,
        });

        if (!chunkResponse.ok) throw new Error(`Failed to upload chunk ${i}`);
        
        setUploadProgress(((i + 1) / totalChunks) * 100);
      }

      const finalizeResponse = await fetch('/api/files/upload/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: upload.uploadId,
          fileName: file.name,
          startupId: 1,
        }),
      });

      if (!finalizeResponse.ok) throw new Error('Failed to finalize upload');
      const { artifact } = await finalizeResponse.json();

      return artifact.storagePath;
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      let pitchDeckUrl = uploadedUrl;

      if (file && !uploadedUrl) {
        pitchDeckUrl = await uploadFile(file);
        setUploadedUrl(pitchDeckUrl);
      }

      await onSubmit({
        message: message || 'I would love to connect and discuss my startup with you.',
        pitchDeckUrl: pitchDeckUrl || undefined,
      });

    } catch (error) {
      toast({
        title: 'Upload Failed',
        description: 'Failed to upload pitch deck. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setMessage('');
    setFile(null);
    setUploadedUrl(null);
    setUploadProgress(0);
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-[hsl(222,47%,15%)] border-white/10">
        <DialogHeader>
          <DialogTitle className="text-[hsl(0,0%,98%)]">Request Connection</DialogTitle>
          <DialogDescription className="text-[hsl(220,9%,65%)]">
            Send a connection request to {investorName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="message" className="text-[hsl(0,0%,98%)]">
              Message
            </Label>
            <Textarea
              id="message"
              placeholder="Tell the investor about your startup..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="bg-[hsl(222,47%,20%)] border-white/10 text-[hsl(0,0%,98%)] min-h-[100px]"
              data-testid="textarea-message"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[hsl(0,0%,98%)]">Pitch Deck (Optional)</Label>
            
            {!file && !uploadedUrl ? (
              <div className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center hover:border-[hsl(217,91%,60%)]/50 transition-colors">
                <input
                  type="file"
                  id="pitch-deck"
                  className="hidden"
                  accept=".pdf,.ppt,.pptx"
                  onChange={handleFileChange}
                  data-testid="input-file"
                />
                <label
                  htmlFor="pitch-deck"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="w-8 h-8 text-[hsl(220,9%,65%)]" />
                  <p className="text-sm text-[hsl(220,9%,65%)]">
                    Click to upload PDF or PowerPoint
                  </p>
                  <p className="text-xs text-[hsl(220,9%,65%)]">Max 50MB</p>
                </label>
              </div>
            ) : (
              <div className="border border-white/10 rounded-lg p-4 bg-[hsl(222,47%,20%)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {uploadedUrl ? (
                      <CheckCircle className="w-5 h-5 text-[hsl(142,71%,45%)]" />
                    ) : (
                      <FileText className="w-5 h-5 text-[hsl(217,91%,60%)]" />
                    )}
                    <span className="text-sm text-[hsl(0,0%,98%)]" data-testid="text-filename">
                      {file?.name}
                    </span>
                  </div>
                  {!isUploading && !uploadedUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFile(null)}
                      data-testid="button-remove-file"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {isUploading && (
                  <div className="space-y-2">
                    <Progress value={uploadProgress} className="h-2" />
                    <p className="text-xs text-[hsl(220,9%,65%)]">
                      Uploading... {Math.round(uploadProgress)}%
                    </p>
                  </div>
                )}
                {uploadedUrl && (
                  <p className="text-xs text-[hsl(142,71%,45%)]">Upload complete</p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isPending || isUploading}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || isUploading || !message.trim()}
            className="bg-gradient-to-r from-[hsl(217,91%,60%)] to-[hsl(270,75%,65%)] hover:opacity-90"
            data-testid="button-submit-connection"
          >
            {isPending ? 'Sending...' : 'Send Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
