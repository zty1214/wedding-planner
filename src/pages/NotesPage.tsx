import { useState, useRef } from 'react'
import { useWeddingStore } from '../stores/useWeddingStore'
import { NOTE_CATEGORIES } from '../types'
import { Plus, Trash2, ImagePlus, X, StickyNote } from 'lucide-react'

export default function NotesPage() {
  const { notes, addNote, removeNote } = useWeddingStore()
  const [activeTab, setActiveTab] = useState<string>(NOTE_CATEGORIES[0])
  const [showEditor, setShowEditor] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const filteredNotes = notes.filter((n) => n.category === activeTab)

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        setImages((prev) => [...prev, reader.result as string])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const handlePublish = () => {
    if (!title.trim() && !content.trim()) return
    addNote(activeTab, title.trim(), content.trim(), images)
    setTitle('')
    setContent('')
    setImages([])
    setShowEditor(false)
  }

  return (
    <div className="h-full flex flex-col p-6 max-w-3xl mx-auto">
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6">
        {NOTE_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === cat
                ? 'bg-[#d4728a] text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-[#f0c4d0]'
            }`}
          >
            {cat}
          </button>
        ))}
        <button
          onClick={() => setShowEditor(true)}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-[#d4728a] text-white rounded-lg text-sm font-medium hover:bg-[#b85a72] transition-colors"
        >
          <Plus className="w-4 h-4" /> 写笔记
        </button>
      </div>

      {/* Editor */}
      {showEditor && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 shadow-sm">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（选填）"
            className="w-full text-base font-medium text-gray-800 placeholder-gray-300 border-none outline-none mb-3"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`记录关于「${activeTab}」的想法、对比、感受...`}
            rows={4}
            className="w-full text-sm text-gray-700 placeholder-gray-300 border-none outline-none resize-none"
          />

          {/* Image previews */}
          {images.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden group">
                  <img src={img} className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 p-0.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
            >
              <ImagePlus className="w-4 h-4" /> 添加图片
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => { setShowEditor(false); setTitle(''); setContent(''); setImages([]) }}
                className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePublish}
                className="px-4 py-1.5 bg-[#d4728a] text-white text-sm rounded-lg font-medium hover:bg-[#b85a72] transition-colors"
              >
                发布
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {filteredNotes.length === 0 && (
          <div className="text-center py-16">
            <StickyNote className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">
              还没有关于「{activeTab}」的笔记
            </p>
            <p className="text-gray-300 text-xs mt-1">点击"写笔记"开始记录</p>
          </div>
        )}
        {filteredNotes.map((note) => (
          <div key={note.id} className="bg-white rounded-xl border border-gray-100 p-4 group">
            <div className="flex items-start justify-between">
              {note.title && (
                <h3 className="text-sm font-semibold text-gray-800 mb-1">{note.title}</h3>
              )}
              <button
                onClick={() => removeNote(note.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all ml-auto shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {note.content && (
              <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{note.content}</p>
            )}
            {note.images.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {note.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    className="w-24 h-24 object-cover rounded-lg border border-gray-100"
                  />
                ))}
              </div>
            )}
            <div className="text-xs text-gray-300 mt-3">
              {new Date(note.createdAt).toLocaleString('zh-CN', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
