import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Download, ExternalLink, Edit2, Check, X, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadFile, getFiles, deleteFile, updateFileMetadata, type FileListItem } from '@/api/client';

export function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [addingTagFile, setAddingTagFile] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // 파일 목록 조회
  const { data: files = [] } = useQuery({
    queryKey: ['files'],
    queryFn: getFiles,
  });

  // 파일 업로드
  const uploadMutation = useMutation({
    mutationFn: uploadFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });

  // 파일 메타데이터 업데이트
  const updateMutation = useMutation({
    mutationFn: ({ filename, updates }: { filename: string; updates: { originalName?: string; tags?: string[] } }) =>
      updateFileMetadata(filename, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      // 편집 상태 초기화
      setEditingFile(null);
      setEditedName('');
      setAddingTagFile(null);
      setNewTag('');
    },
  });

  // 파일 삭제
  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });

  const handleFileSelect = (file: File) => {
    uploadMutation.mutate(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR');
  };

  const handleDownload = (file: FileListItem) => {
    // 파일 다운로드
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getFileIcon = (mimetype: string) => {
    if (mimetype.startsWith('image/')) return '🖼️';
    if (mimetype.includes('pdf')) return '📄';
    if (mimetype.includes('text')) return '📝';
    if (mimetype.includes('json')) return '📋';
    return '📎';
  };

  // 파일명 편집 시작
  const startEditingName = (file: FileListItem) => {
    setEditingFile(file.filename);
    setEditedName(file.originalName);
  };

  // 파일명 편집 저장
  const saveEditedName = (filename: string) => {
    if (editedName.trim() && editedName !== files.find(f => f.filename === filename)?.originalName) {
      updateMutation.mutate({
        filename,
        updates: { originalName: editedName.trim() }
      });
    } else {
      // 변경사항이 없으면 편집 모드만 종료
      setEditingFile(null);
      setEditedName('');
    }
  };

  // 파일명 편집 취소
  const cancelEditingName = () => {
    setEditingFile(null);
    setEditedName('');
  };

  // 태그 추가 모드 시작
  const startAddingTag = (filename: string) => {
    setAddingTagFile(filename);
    setNewTag('');
  };

  // 태그 추가
  const addTag = (file: FileListItem) => {
    if (newTag.trim()) {
      const updatedTags = [...(file.tags || []), newTag.trim()];
      updateMutation.mutate({
        filename: file.filename,
        updates: { tags: updatedTags }
      });
      // mutation이 성공하면 onSuccess에서 상태가 초기화됨
    }
  };

  // 태그 삭제
  const removeTag = (file: FileListItem, tagToRemove: string) => {
    const updatedTags = file.tags.filter(tag => tag !== tagToRemove);
    updateMutation.mutate({
      filename: file.filename,
      updates: { tags: updatedTags }
    });
  };

  return (
    <div className="space-y-4">
      {/* 업로드 영역 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <p className="text-sm text-gray-600 mb-2">
          파일을 드래그하거나 클릭하여 업로드
        </p>
        <p className="text-xs text-gray-500 mb-4">
          이미지, PDF, 문서 등 모든 파일 형식 지원
        </p>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleInputChange}
          className="hidden"
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? '업로드 중...' : '파일 선택'}
        </Button>
      </div>

      {/* 파일 목록 */}
      {files.length > 0 && (
        <div className="border rounded-lg divide-y bg-white">
          <div className="p-4 bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              업로드된 파일 ({files.length}개)
            </h3>
            <p className="text-xs text-gray-500">
              다운로드하여 Claude Desktop에 첨부하세요
            </p>
          </div>
          <div className="divide-y">
            {files.map((file: FileListItem) => (
              <div key={file.filename} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  {/* 파일 정보 */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-2xl flex-shrink-0 mt-0.5">
                      {getFileIcon(file.mimetype)}
                    </span>
                    <div className="flex-1 min-w-0">
                      {/* 파일명 */}
                      <div className="flex items-center gap-2">
                        {editingFile === file.filename ? (
                          <>
                            <input
                              type="text"
                              value={editedName}
                              onChange={(e) => setEditedName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditedName(file.filename);
                                if (e.key === 'Escape') cancelEditingName();
                              }}
                              className="text-sm font-medium text-gray-900 border rounded px-2 py-1 flex-1"
                              autoFocus
                            />
                            <button
                              onClick={() => saveEditedName(file.filename)}
                              className="text-green-600 hover:text-green-700 flex-shrink-0"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEditingName}
                              className="text-red-600 hover:text-red-700 flex-shrink-0"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <h4 className="text-sm font-medium text-gray-900 truncate">
                              {file.originalName}
                            </h4>
                            <button
                              onClick={() => startEditingName(file)}
                              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                              title="파일명 수정"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                              title="새 탭에서 열기"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </>
                        )}
                      </div>

                      {/* 메타데이터 */}
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span>{formatFileSize(file.size)}</span>
                        <span>•</span>
                        <span>{file.mimetype.split('/')[1]?.toUpperCase()}</span>
                        <span>•</span>
                        <span>{formatDate(file.created)}</span>
                      </div>

                      {/* 태그 */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {file.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            {tag}
                            <button
                              onClick={() => removeTag(file, tag)}
                              className="hover:text-blue-900"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        {addingTagFile === file.filename ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={newTag}
                              onChange={(e) => setNewTag(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') addTag(file);
                                if (e.key === 'Escape') setAddingTagFile(null);
                              }}
                              placeholder="태그 입력"
                              className="text-xs border rounded px-2 py-0.5 w-24"
                              autoFocus
                            />
                            <button
                              onClick={() => addTag(file)}
                              className="text-green-600 hover:text-green-700"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setAddingTagFile(null)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startAddingTag(file.filename)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
                          >
                            <Tag className="h-3 w-3" />
                            태그 추가
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 액션 버튼 */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(file)}
                      className="h-8"
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      다운로드
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(file.filename)}
                      disabled={deleteMutation.isPending}
                      className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
