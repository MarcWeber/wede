export type StartCurrent = {
    start: Point2D
    current: Point2D
}
export type SwipeState = {
    abs: Point2D, // obsolute to page
    screen: Point2D, // realtive to screen coordinates
    diff: Point2D,
    distance: number,
    mobile: boolean,
    mode?: string
}

export type SwipeButtonTarget = {
    label: string
    direction: Point2D
}

// delta-y < y_accuracy + some extra pixels
export const is_x_scroll = ({diff}: SwipeState, y_accuracy = 25) =>
    (abs(diff[1]) - abs(diff[0]) / 40) < y_accuracy

const D = 20
export const swipe_direction = (name) => {
    // top or top-left or bottom or bottom-right
    const patches = [
        ['top', [0, D]],
        ['bottom', [0, -D]],
        ['left', [-D, 0]],
        ['right', [D, 0]]
    ]
    const p = [0,0]
    for (const v of patches) {
        if (name.includes(v[0]))
            p = point2dadd(p2 v[1])
    }
    return p
}

// buttons towards which you can swipe
export type SwipeButtonTargetForRendering = {pos: Point2D, selected?: true}
// given some buttons signals which ones is closest based on swipe position
export const swipe_button_targets = ({start, current, distance}: SwipeState, targets: SwipeButtonTarget[]) => {
    const min_swipe_distance = 10
    const max_button_distance = 15
    let idx = null // closest target idx
    const show_targets: SwipeButtonTargetForRendering[] = []
    let mouse_hint = null
    const boundingbox = [[0,0], [0,0]]
    if (distance > min_swipe_distance){
        let min_button_distance = 0
        for (const v of targets) {
            show_targets.push({
                pos: targets.direction
            })
        }
        if (idx && min_button_distance <= max_button_distance){
            show_targets[idx].selected = true
        } else idx = null
    }
    return {
        idx, // closest idx
        show_targets,
        mouse_hint
        rect:
    }
}

export const render_swipe_button_hints(targets: SwipeButtonTargetForRendering[]) => {
    // all texts small 8px
    // the idx selected one 16px
}

/* now the tab based drag & drop is like this:
    if is_x_scroll then its x scroll (move tabs)
    otherwise if button is selected its button
    otherwise if the drag distance is more than 3 * D
    then switch to mode = "tab-drag"
    then the tab can be placed anywhere
    -> same tab list -> change position
    -> top left riht right -> add container the way it is
    -> anywhere _> create new container and place there if possible preserving window size
*/
