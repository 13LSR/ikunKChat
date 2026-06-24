import { FileAttachment } from '../types';

// 定义压缩选项
const compressionOptions = {
  maxSizeMB: 1,       // 限制最大文件大小为 1MB
  maxWidthOrHeight: 1920, // 限制最大宽度或高度
  useWebWorker: false,   // 禁用Web Worker以避免消息通道错误
};

export const fileToData = async (file: File): Promise<FileAttachment> => {
  try {
    // 检查是否为图片文件
    if (file.type.startsWith('image/')) {
      const { default: imageCompression } = await import('browser-image-compression');

      // 压缩图片
      let compressedFile;
      try {
        compressedFile = await imageCompression(file, compressionOptions);
      } catch (compressionError) {
        console.error('图片压缩失败:', compressionError);
        throw new Error(`图片压缩失败: ${compressionError instanceof Error ? compressionError.message : String(compressionError)}`);
      }

      // 使用压缩后的文件进行Base64转换
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onloadend = () => {
          if (!reader.result || typeof reader.result !== 'string') {
            reject(new Error('FileReader返回无效结果'));
            return;
          }
          
          const resultString = reader.result as string;
          
          // 分割data URL，提取base64数据部分
          const parts = resultString.split(',');
          if (parts.length !== 2) {
            reject(new Error('Base64数据格式错误'));
            return;
          }
          
          const base64data = parts[1];
          
          resolve({
            name: compressedFile.name,
            mimeType: compressedFile.type,
            data: base64data
          });
        };
        
        reader.onerror = (error) => {
          console.error('文件读取失败:', error);
          reject(new Error(`文件读取失败: ${reader.error?.message || '未知错误'}`));
        };
        
        reader.readAsDataURL(compressedFile);
      });
    } else {
      // 非图片文件直接处理
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onloadend = () => {
          if (!reader.result || typeof reader.result !== 'string') {
            reject(new Error('FileReader返回无效结果'));
            return;
          }
          
          const base64data = (reader.result as string).split(',')[1];
          
          resolve({
            name: file.name,
            mimeType: file.type,
            data: base64data
          });
        };
        
        reader.onerror = (error) => {
          console.error('文件读取失败:', error);
          reject(new Error(`文件读取失败: ${reader.error?.message || '未知错误'}`));
        };
        
        reader.readAsDataURL(file);
      });
    }
  } catch (error) {
    console.error('文件处理失败:', error);
    throw error;
  }
};

const supportedMimeTypes = new Set([
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const supportedFileExtensions = new Set([
  '.txt',
  '.md',
  '.pdf',
  '.docx',
]);

export const getSupportedMimeTypes = (): string => {
  return '.txt,.md,.pdf,.docx';
};

export const isFileSupported = (file: File): boolean => {
  const lowerName = file.name.toLowerCase();
  if (Array.from(supportedFileExtensions).some(ext => lowerName.endsWith(ext))) {
    return true;
  }

  return file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
};
