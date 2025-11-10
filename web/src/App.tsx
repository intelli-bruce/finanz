import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query';
import { MDXEditor, headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, markdownShortcutPlugin } from '@mdxeditor/editor';
import { RefreshCw, Save, FileText, Upload } from 'lucide-react';
import '@mdxeditor/editor/style.css';
import { readMarkdown, writeMarkdown } from './api/client';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/FileUpload';

const queryClient = new QueryClient();

type TabType = 'editor' | 'files';

function FinanzEditor() {
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('editor');

  // 마크다운 파일 읽기
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['markdown'],
    queryFn: readMarkdown,
  });

  // 마크다운 파일 쓰기
  const mutation = useMutation({
    mutationFn: writeMarkdown,
    onSuccess: () => {
      setIsSaving(false);
      alert('저장되었습니다!');
    },
    onError: (error) => {
      setIsSaving(false);
      alert('저장 실패: ' + error.message);
    },
  });

  // 데이터 로드 시 content 업데이트
  useEffect(() => {
    if (data) {
      setContent(data);
    }
  }, [data]);

  const handleSave = () => {
    setIsSaving(true);
    mutation.mutate(content);
  };

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-destructive">
          에러: {error instanceof Error ? error.message : '알 수 없는 에러'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 헤더 - 고정 */}
      <header className="sticky top-0 z-50 w-full border-b bg-white shadow-sm">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="flex h-14 items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">Finanz</h1>
            {activeTab === 'editor' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  새로고침
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  {isSaving ? '저장 중...' : '저장'}
                </Button>
              </div>
            )}
          </div>

          {/* 탭 */}
          <div className="flex gap-4 -mb-px">
            <button
              onClick={() => setActiveTab('editor')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'editor'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <FileText className="h-4 w-4" />
              에디터
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'files'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Upload className="h-4 w-4" />
              파일
            </button>
          </div>
        </div>
      </header>

      {/* 컨텐츠 영역 */}
      <main className="max-w-[900px] mx-auto px-6 py-8">
        {activeTab === 'editor' ? (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="p-12">
              {data && (
                <MDXEditor
                  key={data}
                  markdown={data}
                  onChange={setContent}
                  plugins={[
                    headingsPlugin(),
                    listsPlugin(),
                    quotePlugin(),
                    thematicBreakPlugin(),
                    markdownShortcutPlugin(),
                  ]}
                  className="min-h-[calc(100vh-250px)]"
                />
              )}
            </div>
          </div>
        ) : (
          <FileUpload />
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
