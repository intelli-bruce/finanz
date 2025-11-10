import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Save, FolderOpen, Upload, Unlock } from 'lucide-react';
import { readFile, writeFile } from './api/client';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/FileUpload';
import { FileExplorer } from '@/components/FileExplorer';
import { ExcelDecryptor } from '@/components/ExcelDecryptor';

const queryClient = new QueryClient();

type ViewType = 'documents' | 'uploads' | 'decrypt';

function FinanzEditor() {
  const [currentPath, setCurrentPath] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeView, setActiveView] = useState<ViewType>('documents');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  // 선택된 파일 읽기
  const { data: fileContent, isLoading } = useQuery({
    queryKey: ['file-content', selectedFile],
    queryFn: () => readFile(selectedFile!),
    enabled: !!selectedFile,
  });

  // 파일 저장
  const saveMutation = useMutation({
    mutationFn: (data: { path: string; content: string }) =>
      writeFile(data.path, data.content),
    onSuccess: () => {
      setIsSaving(false);
    },
    onError: (error) => {
      setIsSaving(false);
      alert('저장 실패: ' + error.message);
    },
  });

  // 파일 내용 로드
  useEffect(() => {
    if (fileContent !== undefined) {
      setContent(fileContent);
      // 코드 블록 디버깅
      const codeBlockMatch = fileContent.match(/```[\s\S]*?```/g);
      console.log('Code blocks found:', codeBlockMatch?.length || 0);
      if (codeBlockMatch) {
        console.log('First code block:', codeBlockMatch[0].substring(0, 200));
      }
    }
  }, [fileContent, selectedFile, isLoading]);

  const handleSave = () => {
    if (!selectedFile) return;
    setIsSaving(true);
    saveMutation.mutate({ path: selectedFile, content });
  };

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
  };

  // Cmd+\ 키보드 단축키로 사이드바 토글
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setIsSidebarVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* 미니멀 헤더 */}
      <header className="flex items-center justify-between px-8 h-16 bg-white border-b">
        {/* 로고 영역 */}
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Finanz</h1>

          {/* 뷰 전환 탭 */}
          <nav className="flex gap-1">
            <button
              onClick={() => setActiveView('documents')}
              className={`
                flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                transition-all duration-200
                ${
                  activeView === 'documents'
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }
              `}
            >
              <FolderOpen className="h-4 w-4" />
              <span>Documents</span>
            </button>
            <button
              onClick={() => setActiveView('uploads')}
              className={`
                flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                transition-all duration-200
                ${
                  activeView === 'uploads'
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }
              `}
            >
              <Upload className="h-4 w-4" />
              <span>Uploads</span>
            </button>
            <button
              onClick={() => setActiveView('decrypt')}
              className={`
                flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                transition-all duration-200
                ${
                  activeView === 'decrypt'
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }
              `}
            >
              <Unlock className="h-4 w-4" />
              <span>Decrypt</span>
            </button>
          </nav>
        </div>

        {/* 우측 액션 영역 */}
        <div className="flex items-center gap-3">
          {activeView === 'documents' && selectedFile && (
            <>
              <div className="text-sm text-gray-500 font-mono truncate max-w-xs">
                {selectedFile}
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="bg-gray-900 hover:bg-gray-800 text-white"
              >
                <Save className="h-3.5 w-3.5 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex overflow-hidden">
        {activeView === 'documents' ? (
          <>
            {/* 파일 탐색기 */}
            {isSidebarVisible && (
              <aside className="w-64 bg-white border-r flex-shrink-0 transition-all duration-200">
                <FileExplorer
                  currentPath={currentPath}
                  onFileSelect={handleFileSelect}
                  onPathChange={setCurrentPath}
                  selectedFile={selectedFile}
                />
              </aside>
            )}

            {/* 에디터 영역 */}
            <div className="flex-1 overflow-y-scroll" style={{ overflowY: 'scroll', WebkitOverflowScrolling: 'touch' }}>
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-sm text-gray-500">로딩 중...</div>
              ) : selectedFile && fileContent !== undefined ? (
                <div className="w-full max-w-4xl mx-auto py-8 px-8">
                  <div className="bg-white rounded-lg shadow-sm border p-8">
                    <CodeMirror
                      value={content}
                      height="auto"
                      minHeight="600px"
                      extensions={[
                        markdown({ base: markdownLanguage, codeLanguages: languages })
                      ]}
                      onChange={(value) => setContent(value)}
                      theme="light"
                      basicSetup={{
                        lineNumbers: true,
                        highlightActiveLineGutter: true,
                        highlightSpecialChars: true,
                        foldGutter: true,
                        drawSelection: true,
                        dropCursor: true,
                        allowMultipleSelections: true,
                        indentOnInput: true,
                        bracketMatching: true,
                        closeBrackets: true,
                        autocompletion: true,
                        rectangularSelection: true,
                        crosshairCursor: true,
                        highlightActiveLine: true,
                        highlightSelectionMatches: true,
                        closeBracketsKeymap: true,
                        searchKeymap: true,
                        foldKeymap: true,
                        completionKeymap: true,
                        lintKeymap: true,
                      }}
                      style={{ fontSize: '14px' }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-center text-gray-500">
                  <div>
                    <FolderOpen className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm">파일을 선택하세요</p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeView === 'uploads' ? (
          <div className="flex-1 overflow-auto">
            <div className="max-w-4xl mx-auto p-8">
              <FileUpload />
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="p-8">
              <ExcelDecryptor />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FinanzEditor />
    </QueryClientProvider>
  );
}

export default App;
