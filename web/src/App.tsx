import { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Save, FolderOpen, PanelBottomClose, PanelBottomOpen } from 'lucide-react';
import { readFile, writeFile } from './api/client';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/FileUpload';
import { FileExplorer } from '@/components/FileExplorer';
import { ExcelDecryptor } from '@/components/ExcelDecryptor';
import { CashflowView } from '@/components/CashflowView';
import { BalanceSheetView } from '@/components/BalanceSheetView';
import { DockMenu } from '@/components/DockMenu';
import type { ViewType } from '@/types/views';

const queryClient = new QueryClient();

const viewMeta: Record<ViewType, { label: string; description: string }> = {
  documents: {
    label: 'Documents',
    description: 'Markdown workspace & 파일 탐색',
  },
  uploads: {
    label: 'Uploads',
    description: '대량 업로드 및 첨부 관리',
  },
  decrypt: {
    label: 'Decrypt',
    description: '암호화 Excel 해제 도구',
  },
  cashflow: {
    label: 'Cashflow',
    description: '월별 현금흐름표 & 요약',
  },
  balance: {
    label: 'Balance Sheet',
    description: '월별 대차대조표 요약',
  },
};

function FinanzEditor() {
  const [currentPath, setCurrentPath] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeView, setActiveView] = useState<ViewType>('documents');
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [dockHeight, setDockHeight] = useState(0);
  const [isDocumentsHovering, setIsDocumentsHovering] = useState(false);
  const [isExplorerHovering, setIsExplorerHovering] = useState(false);
  const documentsHoverTimeout = useRef<number | null>(null);

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
        setIsExplorerOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (documentsHoverTimeout.current) {
        window.clearTimeout(documentsHoverTimeout.current);
      }
    };
  }, []);

  const shouldShowExplorer =
    activeView === 'documents' && isExplorerOpen && (isDocumentsHovering || isExplorerHovering);
  const explorerBottomOffset = dockHeight ? dockHeight + 24 + 5 : 140;

  return (
    <div className="relative h-screen flex flex-col bg-gray-50">
      {/* 상단 헤더 */}
      <header className="flex items-center justify-between px-8 h-16 bg-white/95 border-b backdrop-blur">
        {/* 로고 영역 */}
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Finanz</h1>
          <div className="hidden md:flex flex-col">
            <span className="text-xs uppercase tracking-widest text-gray-400">Active View</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{viewMeta[activeView].label}</span>
              <span className="text-xs text-gray-500">{viewMeta[activeView].description}</span>
            </div>
          </div>
        </div>

        {/* 우측 액션 영역 */}
        <div className="flex items-center gap-3">
          {activeView === 'documents' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExplorerOpen(prev => !prev)}
              className="text-gray-600 hover:text-gray-900"
            >
              {isExplorerOpen ? (
                <PanelBottomClose className="h-4 w-4 mr-2" />
              ) : (
                <PanelBottomOpen className="h-4 w-4 mr-2" />
              )}
              탐색기 {isExplorerOpen ? '숨기기' : '열기'}
            </Button>
          )}
          {activeView === 'documents' && selectedFile && (
            <>
              <div className="hidden md:block text-sm text-gray-500 font-mono truncate max-w-xs">
                {selectedFile}
              </div>
              <div className="hidden md:block h-4 w-px bg-gray-200" />
            </>
          )}
          {activeView === 'documents' && selectedFile && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="bg-gray-900 hover:bg-gray-800 text-white"
            >
              <Save className="h-3.5 w-3.5 mr-2" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex overflow-hidden">
        {activeView === 'documents' ? (
          <div className="relative flex-1">
            {/* 에디터 영역 */}
            <div className="h-full overflow-y-auto pb-[280px]">
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
                      onChange={(value: string) => setContent(value)}
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

            {/* 파일 탐색기 하단 패널 */}
            <div
              className={`absolute inset-x-0 px-6 transition-all duration-500 ${
                shouldShowExplorer
                  ? 'translate-y-0 opacity-100 pointer-events-auto'
                  : 'translate-y-[60%] opacity-0 pointer-events-none'
              }`}
              style={{ bottom: `${explorerBottomOffset}px` }}
              onMouseEnter={() => setIsExplorerHovering(true)}
              onMouseLeave={() => setIsExplorerHovering(false)}
            >
              <div
                className={`mx-auto w-full max-w-3xl rounded-[28px] border border-white/60 bg-white/95 shadow-[0_30px_45px_rgba(15,23,42,0.18)] backdrop-blur-xl ${
                  shouldShowExplorer ? 'pointer-events-auto' : 'pointer-events-none'
                }`}
              >
                <div className="h-64 overflow-hidden rounded-[28px]">
                  <FileExplorer
                    currentPath={currentPath}
                    onFileSelect={handleFileSelect}
                    onPathChange={setCurrentPath}
                    selectedFile={selectedFile}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : activeView === 'uploads' ? (
          <div className="flex-1 overflow-auto">
            <div className="max-w-4xl mx-auto p-8">
              <FileUpload />
            </div>
          </div>
        ) : activeView === 'decrypt' ? (
          <div className="flex-1 overflow-auto">
            <div className="p-8">
              <ExcelDecryptor />
            </div>
          </div>
        ) : activeView === 'cashflow' ? (
          <div className="flex-1 overflow-auto">
            <CashflowView />
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <BalanceSheetView />
          </div>
        )}
      </main>

      {/* 하단 Dock */}
      <DockMenu
        activeView={activeView}
        onChange={setActiveView}
        onDocumentsHoverChange={(next) => {
          if (documentsHoverTimeout.current) {
            window.clearTimeout(documentsHoverTimeout.current);
            documentsHoverTimeout.current = null;
          }
          if (next) {
            setIsDocumentsHovering(true);
          } else {
            documentsHoverTimeout.current = window.setTimeout(() => {
              setIsDocumentsHovering(false);
              documentsHoverTimeout.current = null;
            }, 120);
          }
        }}
        onHeightChange={setDockHeight}
      />
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
