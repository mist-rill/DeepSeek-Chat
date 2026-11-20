import { closeMobileSider, hideSoftKeyboard, openMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'

/**
 * 移动端聊天记录抽屉的拖动 / 开合动画。
 *
 * 设计要点（都是为了「跟手」）：
 * 1. 进度只写 transform / opacity 这两个合成器属性，**不写 CSS 变量、不碰布局属性**——
 *    marginBlock 每帧变会让整棵聊天树重排、boxShadow 每帧变会让卡片层整体重栅格化，
 *    这两样正是之前「卡卡的、有点抽搐」的来源；改用 scale 收出上下留白、投影写成常量
 *    （关闭时卡片满屏、阴影整体在视口外被裁掉，天然不可见）；
 * 2. 卡片位移 + 缩放都是 transform（合成层），不碰 left/width（每帧重排）；
 * 3. touchmove 用 rAF 合并，一个渲染帧最多写一次；--drawer-peek 只在手势开始时量一次，
 *    不在 move 里 getComputedStyle（那会强制样式/布局同步刷新）；
 * 4. 横向手势一确认就 preventDefault，别让浏览器抢占去滚动——一旦它接管就会
 *    touchcancel 掉整个手势，表现就是「划到一半不动了」；
 * 5. 松手按「速度 + 进度」决定去留，快速一甩也能开/关；补间由 JS 用 rAF 完成，
 *    不用 CSS transition，所以中途再按住不会和残余动画打架。
 */

/** 卡片几何：官方 1200×2670 截屏量得上下留白 22dp（用 scale 收出来，圆角走 --screen-radius） */
const CARD_INSET = 22
/** 横向位移超过它才算握住抽屉 */
const DRAG_SLOP = 6
/** 松手瞬间的横向速度（px/ms）：超过就按方向直接补完，实现「一甩就开」 */
const FLICK = 0.3
/** 没有甩动时按进度决定：关着拖过 OPEN_AT 展开，开着拖到 CLOSE_AT 以下收起 */
const OPEN_AT = 0.42
const CLOSE_AT = 0.58

export const bindDrawerGesture = (frame: HTMLElement) => {
  const main = frame.querySelector<HTMLElement>('main')
  const drawer = frame.querySelector<HTMLElement>('[data-drawer]')
  // 暗化层在 frame 层：连卡片圆角外露出的底衬一起变暗，避免角外留一圈亮色
  const dim = frame.querySelector<HTMLElement>('[data-drawer-dim]')
  if (!main || !drawer) {
    return () => {}
  }

  let progress = 0
  /** 卡片可走的距离 = 屏宽 − 露出宽度 */
  let shift = 1
  /** 每单位进度对应的 scale 收缩量 = 2×留白 / 卡片高度，measure 时算好 */
  let insetK = 0
  let paint = 0
  let anim = 0
  /** 程序自己改 open 状态时置真，避免订阅里再启动一次动画 */
  let internal = false
  let tracking = false
  let dragging = false
  let startX = 0
  let startY = 0
  let base = 0
  /** 按下去时正好在补间中途：抬起若没拖动就接着补完，不然卡片会僵在半路 */
  let caught = false
  let samples: { x: number; t: number }[] = []

  const measure = () => {
    const peek = Number.parseFloat(getComputedStyle(frame).getPropertyValue('--drawer-peek'))
    shift = Math.max(1, frame.clientWidth - (Number.isFinite(peek) ? peek : 0))
    insetK = frame.clientHeight > 0 ? (2 * CARD_INSET) / frame.clientHeight : 0
  }

  /*
   * 每帧只写 transform / opacity，全部走合成层：不动布局、不触发重绘，
   * 拖动和补间期间主线程几乎没有工作量，这是「跟手不抽搐」的关键。
   */
  let lastX = Number.NaN

  const draw = () => {
    const x = shift * progress
    if (x !== lastX) {
      lastX = x
      // scale 以左缘为锚（origin 见 CSS）：左缘始终贴着手指走的 x，上下对称收出留白
      const scale = (1 - insetK * progress).toFixed(4)
      main.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) scale(${scale})`
      drawer.style.transform = `translate3d(${(x - shift).toFixed(2)}px, 0, 0)`
      // 卡片往回盖时抽屉同步变暗，制造「收进底层」的纵深感；opacity 走合成层，不触发重排
      // 最深 0.28：太重会显得记录页脏，轻到刚好能感知「沉下去」
      if (dim) {
        dim.style.opacity = ((1 - progress) * 0.28).toFixed(3)
      }
    }
  }

  /** 关闭态回到纯 CSS 状态，内联样式全部撤掉 */
  const reset = () => {
    progress = 0
    if (paint !== 0) {
      // 已经排队但还没执行的那一帧要是跑完，会把刚清掉的内联样式又写回来
      cancelAnimationFrame(paint)
      paint = 0
    }
    lastX = Number.NaN
    main.style.transform = ''
    drawer.style.transform = ''
    if (dim) {
      dim.style.opacity = ''
    }
  }

  const queue = (value: number) => {
    progress = Math.min(1, Math.max(0, value))
    if (paint === 0) {
      paint = requestAnimationFrame(() => {
        paint = 0
        draw()
      })
    }
  }

  const stopAnim = () => {
    if (anim !== 0) {
      cancelAnimationFrame(anim)
      anim = 0
    }
  }

  /** 从当前进度补到目标：距离越远时长越长，150–380ms；曲线是 ease-out */
  const settleTo = (target: number) => {
    stopAnim()
    const from = progress
    const distance = target - from
    if (Math.abs(distance) < 0.002) {
      progress = target
      if (target === 0) {
        reset()
      } else {
        draw()
      }
      return
    }
    const duration = 150 + 230 * Math.abs(distance)
    const started = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      progress = from + distance * eased
      draw()
      if (t < 1) {
        anim = requestAnimationFrame(step)
        return
      }
      anim = 0
      progress = target
      if (target === 0) {
        reset()
      } else {
        draw()
      }
    }
    anim = requestAnimationFrame(step)
  }

  const setOpen = (open: boolean) => {
    if (useMobileSider.getState().open === open) {
      return
    }
    internal = true
    if (open) {
      openMobileSider()
    } else {
      closeMobileSider()
    }
    internal = false
  }

  const openDrawer = () => {
    setOpen(true)
    settleTo(1)
  }

  const closeDrawer = () => {
    setOpen(false)
    settleTo(0)
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      return
    }
    // 滑杆（字号 / 字重）本身就是横向拖动，手势一旦接管它就只能点不能滑，直接放行
    const target = event.target
    if (target instanceof Element && target.closest('input[type="range"], [data-no-drawer-gesture]')) {
      tracking = false
      return
    }
    const touch = event.touches[0]
    // 补间中按住就停在手指底下，别再往目标溜
    caught = anim !== 0
    stopAnim()
    startX = touch.clientX
    startY = touch.clientY
    base = progress
    samples = [{ x: touch.clientX, t: event.timeStamp }]
    tracking = true
    dragging = false
  }

  const onTouchMove = (event: TouchEvent) => {
    if (!tracking || event.touches.length !== 1) {
      return
    }
    const touch = event.touches[0]
    samples.push({ x: touch.clientX, t: event.timeStamp })
    // 速度只取最近 100ms：手指停住后窗口自然滑过去，速度归零
    while (samples.length > 2 && event.timeStamp - samples[0].t > 100) {
      samples.shift()
    }
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    if (!dragging) {
      // 纵向为主的滑动交给列表滚动
      if (Math.abs(dx) <= Math.abs(dy)) {
        if (Math.abs(dy) > DRAG_SLOP) {
          tracking = false
        }
        return
      }
      const opened = useMobileSider.getState().open || progress > 0.02
      // 关着时左滑不归我们管，留给正文里可横向滚动的代码块、表格
      if (!opened && dx < 0) {
        tracking = false
        return
      }
      // 已确认是横向手势：立刻拦住浏览器，别让它开始滚动（否则会 touchcancel 掉整个手势）
      event.preventDefault()
      if (Math.abs(dx) < DRAG_SLOP) {
        return
      }
      dragging = true
      // 抓住正在补间的卡片：停在当前进度，从这儿继续跟手
      stopAnim()
      base = progress
      frame.dataset.dragging = 'true'
      // 抽屉一开始跟手就把软键盘收起来，不用等松手判定开合
      hideSoftKeyboard()
    } else {
      event.preventDefault()
    }
    queue(base + dx / shift)
  }

  const onTouchEnd = (event: TouchEvent) => {
    if (!tracking) {
      return
    }
    tracking = false
    if (!dragging) {
      if (caught) {
        // 只是按住没拖：把刚才停下的补间接着走完
        caught = false
        settleTo(useMobileSider.getState().open ? 1 : 0)
        return
      }
      // 抽屉开着时点一下右侧聊天卡片：直接回到聊天页（touchcancel 不算点击）
      const opened = useMobileSider.getState().open
      const target = event.changedTouches[0]?.target
      if (
        opened &&
        event.type !== 'touchcancel' &&
        target instanceof Element &&
        main.contains(target)
      ) {
        closeDrawer()
      }
      return
    }
    caught = false
    dragging = false
    delete frame.dataset.dragging
    const last = samples.at(-1)
    const first = samples[0]
    const velocity = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
    samples = []
    if (velocity > FLICK) {
      openDrawer()
      return
    }
    if (velocity < -FLICK) {
      closeDrawer()
      return
    }
    const opened = useMobileSider.getState().open
    const keep = opened ? progress > CLOSE_AT : progress > OPEN_AT
    if (keep) {
      openDrawer()
    } else {
      closeDrawer()
    }
  }

  // 别处以状态为准（顶栏菜单按钮、点遮罩、选中会话）时，带动画地跟过去
  const unsubscribe = useMobileSider.subscribe((state, prev) => {
    if (internal || state.open === prev.open) {
      return
    }
    stopAnim()
    settleTo(state.open ? 1 : 0)
  })

  // 尺寸变化（软键盘、旋转）后重新量一次，避免内联位移停在旧值上
  const observer = new ResizeObserver(() => {
    if (progress <= 0.002) {
      measure()
      return
    }
    measure()
    draw()
  })
  observer.observe(frame)
  measure()

  document.addEventListener('touchstart', onTouchStart, { passive: true })
  // 非 passive：确认横向时才能真正 preventDefault
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onTouchEnd, { passive: true })
  document.addEventListener('touchcancel', onTouchEnd, { passive: true })

  return () => {
    document.removeEventListener('touchstart', onTouchStart)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
    document.removeEventListener('touchcancel', onTouchEnd)
    unsubscribe()
    observer.disconnect()
    stopAnim()
    if (paint !== 0) {
      cancelAnimationFrame(paint)
      paint = 0
    }
    delete frame.dataset.dragging
    reset()
  }
}
