import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query';
import { MDXEditor, headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, markdownShortcutPlugin } from '@mdxeditor/editor';
import { RefreshCw, Save } from 'lucide-react';
import '@mdxeditor/editor/style.css';
import { readMarkdown, writeMarkdown } from './api/client';
import { Button } from '@/components/ui/button';

const queryClient = new QueryClient();

function FinanzEditor() {
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
        <div className="max-w-[900px] mx-auto px-6 flex h-14 items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Finanz</h1>
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
        </div>
      </header>

      {/* 에디터 영역 - 노션 스타일 */}
      <main className="max-w-[900px] mx-auto px-6 py-8">
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
