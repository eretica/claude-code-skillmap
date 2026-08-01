import { useRef, useState } from "react";
import type { DragEvent, ChangeEvent, ReactNode } from "react";
import {
  filesFromDrop,
  filesFromHandle,
  filesFromInput,
  pickDirectoryHandle,
  supportsDirectoryPicker,
} from "../lib/files";

export function Dropzone({
  onFiles,
  onHandle,
  accept,
  directory,
  children,
}: {
  onFiles: (files: File[]) => void;
  /** ディレクトリピッカー経由のとき、取得したハンドルを通知(再解析用の永続化に使う) */
  onHandle?: (handle: unknown) => void;
  accept?: string;
  directory?: boolean;
  children: ReactNode;
}) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragover(false);
    if (directory) {
      onFiles(await filesFromDrop(e.dataTransfer));
    } else {
      onFiles([...e.dataTransfer.files]);
    }
  };

  const handleClick = async () => {
    if (directory && supportsDirectoryPicker()) {
      try {
        const handle = await pickDirectoryHandle();
        onHandle?.(handle);
        onFiles(await filesFromHandle(handle));
      } catch {
        // ユーザーがピッカーをキャンセルした場合は何もしない
      }
    } else {
      inputRef.current?.click();
    }
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    onFiles(directory ? filesFromInput(e.target.files) : [...e.target.files]);
    e.target.value = "";
  };

  return (
    <div
      className={`dropzone${dragover ? " dragover" : ""}`}
      onClick={handleClick}
      onDragOver={(e) => {
        e.preventDefault();
        setDragover(true);
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept={accept}
        onChange={handleInput}
        {...(directory ? { webkitdirectory: "" } : {})}
      />
    </div>
  );
}
