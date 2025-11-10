import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { File, Folder, FolderOpen, Plus, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listFiles, deleteFileOrDir, writeFile, createDirectory, type FileSystemItem } from '@/api/client';

interface FileExplorerProps {
  currentPath: string;
  onFileSelect: (path: string) => void;
  onPathChange: (path: string) => void;
  selectedFile: string | null;
}

export function FileExplorer({ currentPath, onFileSelect, onPathChange, selectedFile }: FileExplorerProps) {
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['files', currentPath],
    queryFn: () => listFiles(currentPath),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFileOrDir,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      if (selectedFile && items.find(item => item.path === selectedFile)) {
        onFileSelect('');
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ type, name }: { type: 'file' | 'folder'; name: string }) => {
      const newPath = currentPath ? `${currentPath}/${name}` : name;
      if (type === 'folder') {
        await createDirectory(newPath);
      } else {
        await writeFile(newPath, '# New File\n\n');
      }
      return newPath;
    },
    onSuccess: (newPath) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      cancelCreating();
      if (newItemType === 'file') {
        onFileSelect(newPath);
      }
    },
  });

  const handleItemClick = (item: FileSystemItem) => {
    if (item.type === 'directory') {
      onPathChange(item.path);
    } else {
      onFileSelect(item.path);
    }
  };

  const handleDelete = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (confirm('정말 삭제하시겠습니까?')) {
      deleteMutation.mutate(path);
    }
  };

  const handleBack = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/');
    onPathChange(parentPath);
  };

  const startCreating = (type: 'file' | 'folder') => {
    setNewItemType(type);
    setNewItemName('');
  };

  const cancelCreating = () => {
    setNewItemType(null);
    setNewItemName('');
  };

  const handleCreate = () => {
    if (!newItemName.trim() || !newItemType) return;
    createMutation.mutate({ type: newItemType, name: newItemName });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">
            {currentPath || 'data'}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startCreating('file')}
            className="h-7 w-7 p-0"
            title="새 파일"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startCreating('folder')}
            className="h-7 w-7 p-0"
            title="새 폴더"
          >
            <Folder className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 파일 목록 */}
      <div className="flex-1 overflow-y-auto">
        {currentPath && (
          <button
            onClick={handleBack}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 text-left"
          >
            <span className="text-gray-500">←</span>
            <span className="text-gray-600">..</span>
          </button>
        )}

        {newItemType && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50">
            {newItemType === 'folder' ? (
              <FolderOpen className="h-4 w-4 text-blue-600" />
            ) : (
              <File className="h-4 w-4 text-blue-600" />
            )}
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreate();
                } else if (e.key === 'Escape') {
                  cancelCreating();
                }
              }}
              placeholder={newItemType === 'folder' ? '폴더 이름' : '파일 이름.md'}
              className="flex-1 px-2 py-1 text-sm border rounded outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              disabled={createMutation.isPending}
            />
          </div>
        )}

        {items.length === 0 && !newItemType ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-500">
            비어있는 폴더입니다
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.path}
              onClick={() => handleItemClick(item)}
              className={`
                flex items-center justify-between px-3 py-2 cursor-pointer
                hover:bg-gray-50 group
                ${selectedFile === item.path ? 'bg-blue-50' : ''}
              `}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {item.type === 'directory' ? (
                  <Folder className="h-4 w-4 text-gray-500 flex-shrink-0" />
                ) : (
                  <File className="h-4 w-4 text-gray-400 flex-shrink-0" />
                )}
                <span className="text-sm text-gray-700 truncate">
                  {item.name}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => handleDelete(e, item.path)}
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3 text-red-500" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
