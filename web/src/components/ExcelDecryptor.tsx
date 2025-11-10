import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, FileSpreadsheet, Download, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export function ExcelDecryptor() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const decryptMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile || !password) {
        throw new Error('파일과 비밀번호를 모두 입력해주세요');
      }

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('password', password);
      formData.append('format', format);

      const response = await axios.post(`${API_BASE_URL}/decrypt-excel`, formData, {
        responseType: 'blob',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // 파일 다운로드
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const filename = format === 'csv'
        ? selectedFile.name.replace(/\.xlsx?$/i, '.csv')
        : selectedFile.name.replace(/\.xlsx?$/i, '_decrypted.xlsx');

      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true };
    },
    onSuccess: () => {
      setError(null);
      // 성공 후 초기화
      setSelectedFile(null);
      setPassword('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onError: (err: any) => {
      if (err.response?.status === 401) {
        setError('비밀번호가 올바르지 않습니다');
      } else {
        setError(err.response?.data?.error || err.message || '암호 해제에 실패했습니다');
      }
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleDecrypt = () => {
    setError(null);
    decryptMutation.mutate();
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border p-8">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-green-100 rounded-lg">
            <Lock className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Excel 암호 해제</h2>
            <p className="text-sm text-gray-500">
              암호화된 Excel 파일의 암호를 해제하고 다운로드하세요
            </p>
          </div>
        </div>

        {/* 파일 선택 */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              암호화된 Excel 파일
            </label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                파일 선택
              </Button>
              {selectedFile && (
                <span className="text-sm text-gray-600 truncate">
                  {selectedFile.name}
                </span>
              )}
            </div>
          </div>

          {/* 비밀번호 입력 */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Excel 파일의 비밀번호를 입력하세요"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && selectedFile && password) {
                  handleDecrypt();
                }
              }}
            />
          </div>

          {/* 출력 형식 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              다운로드 형식
            </label>
            <div className="flex gap-3">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="xlsx"
                  checked={format === 'xlsx'}
                  onChange={(e) => setFormat(e.target.value as 'xlsx')}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">Excel (.xlsx)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="csv"
                  checked={format === 'csv'}
                  onChange={(e) => setFormat(e.target.value as 'csv')}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">CSV (.csv)</span>
              </label>
            </div>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* 암호 해제 버튼 */}
          <Button
            onClick={handleDecrypt}
            disabled={!selectedFile || !password || decryptMutation.isPending}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            {decryptMutation.isPending ? '처리 중...' : '암호 해제 및 다운로드'}
          </Button>
        </div>

        {/* 안내 사항 */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-sm font-medium text-blue-900 mb-2">사용 방법</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• 암호화된 Excel 파일(.xlsx, .xls)을 선택하세요</li>
            <li>• 파일의 비밀번호를 입력하세요</li>
            <li>• 다운로드 형식을 선택하세요 (Excel 또는 CSV)</li>
            <li>• 암호 해제 버튼을 클릭하면 파일이 자동으로 다운로드됩니다</li>
            <li>• CSV 형식은 첫 번째 시트만 변환됩니다</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
