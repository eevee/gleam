import Role from "./role";
import Actor from "./actor";
import {mk} from "./util";
import {promise_transition} from "./promise-event";

export default class DialogueBox extends Role {
  /**
   * @param {string} name
   */
  constructor(name) {
    super(name);

    this.speed = 60;
  }

  to_json() {
    let json = super.to_json();
    json.speed = 60;
    return json;
  }

  generate_initial_state() {
    return {
      // Text currently being displayed.  If null, the dialogue box is hidden.
      // Only lasts one beat.
      phrase: null,
      // Speaker's name.
      speaker: null,
      color: null,
      position: null,
    };
  }
  propagate_state(prev) {
    return {
      ...prev,
      phrase: null,
    };
  }
}
DialogueBox.register('dialogue-box');
DialogueBox.STEP_KINDS = {};
DialogueBox.LEGACY_JSON_ACTIONS = {};
DialogueBox.Actor = class DialogueBoxActor extends Actor {
  constructor(role) {
    super(role, mk('div.gleam-actor-dialoguebox'));

    // Toss in a background element
    this.element.appendChild(mk('div.-background'));

    this.scroll_timeout = null;
    this.speaker_element = null;
    this.letter_elements = [];
    // One of:
    // idle -- there is no text left to display
    // waiting -- there was too much text to fit in the box and we are now waiting on a call to advance() to show more
    // scrolling -- we are actively showing text
    // Automatically sync'd with the data-state attribute on the main
    // element.
    this.scroll_state = 'idle';
    // How much spare time has passed; characters will appear until this
    // runs out.  Is usually zero or negative, to indicate a time debt; no
    // characters will appear until the debt has been paid.
    this.time = 0;
  }

  get scroll_state() {
    return this._scroll_state;
  }
  set scroll_state(state) {
    this._scroll_state = state;
    this.element.setAttribute('data-state', state);
  }

  apply_state(state) {
    let old_state = super.apply_state(state);

    if (state.phrase === null) {
      // Hide and return
      // TODO what should this do to speaker tags?  i think this is why
      // the old code had that wrong speaker bug: try jumping to the very
      // last beat, then back to someone else, and it won't update
      // FIXME this means disappearing during a curtain lower, which
      // seems goofy?  maybe need a special indicator for "do nothing no
      // matter what the textbox looks like atm"?  er but how would that
      // be conveyed here.
      this.hide();
      return;
    }

    // Update the dialogue "position" -- this is usually something simple
    // like "left" or "right" to match the side the speaker is on, but it
    // might also restyle the entire dialogue
    // TODO maybe that's a sign that this is a bad name
    if (state.position === null) {
      this.element.removeAttribute('data-position');
    }
    else {
      this.element.setAttribute('data-position', state.position);
    }

    // Deal with the speaker tag.  If there's an old tag, and it doesn't
    // match the new name (which might be null), remove it
    // TODO super weird bug in old code: set the transition time to
    // something huge like 10s and mash arrow keys mid-transition and
    // sometimes you end up with dialogue attributed to the wrong speaker!
    if (old_state.speaker !== null && old_state.speaker !== state.speaker) {
      // Don't just remove it directly; give it a chance to transition
      let old_speaker_element = this.speaker_element;
      this.speaker_element = null;
      old_speaker_element.classList.add('--hidden');
      promise_transition(old_speaker_element).then(() => {
        this.element.removeChild(old_speaker_element);
      });
    }

    // If there's meant to be a speaker now, add a tag
    if (state.speaker !== null && ! this.speaker_element) {
      this.speaker_element = mk('div.-speaker.--hidden', {}, state.speaker);
      this.element.appendChild(this.speaker_element);

      // Force layout recomputation, then remove the class so the
      // "appear" transition happens
      this.speaker_element.offsetTop;
      this.speaker_element.classList.remove('--hidden');
    }

    // And update the color
    if (state.color === null) {
      this.element.style.removeProperty('--color');
    }
    else {
      this.element.style.setProperty('--color', state.color);
    }

    // Finally, say the line
    this.say(state.phrase);
  }

  say(text) {
    this.element.classList.remove('--hidden');

    // Create the dialogue DOM
    if (this.phrase_wrapper_element) {
      this.element.removeChild(this.phrase_wrapper_element);
    }
    this._build_phrase_dom(text);

    this.scroll_state = 'scrolling';
    this._start_scrolling();
  }

  hide() {
    this.element.classList.add('--hidden');
    // TODO should this reset any scroll state etc?
  }

  _build_phrase_dom(text) {
    // Break 'text' -- which is taken to be raw HTML! -- into a sequence of
    // characters, cleverly preserving the nesting of any tags used within.
    let source = document.createElement('div');
    source.innerHTML = text;
    let target = document.createDocumentFragment();

    let current_node = source.firstChild;
    let current_target = target;
    let letters = [];
    let all_word_endings = [];
    while (current_node) {
      if (current_node.nodeType === Node.TEXT_NODE) {
        let text_chunk = current_node.nodeValue;
        let i = 0;
        while (true) {
          // TODO astral plane  :/
          let ch = text_chunk.charAt(i);
          if (ch) {
            i++;
          }
          else {
            break;
          }

          // Stick spaces onto the end of the previous span; reduces
          // the DOM size by a decent chunk which makes life faster
          // all around.  And it doesn't matter if the space is on
          // the boundary of an inline element, either!
          if (letters.length > 0 && ch === " ") {
            let letter = letters[letters.length - 1];
            letter.textContent += ch;
            all_word_endings.push(letter);
          }
          else {
            let letter = document.createElement('span');
            letter.textContent = ch;
            letters.push(letter);
            current_target.appendChild(letter);
          }
        }
      }
      else if (current_node.nodeType === Node.ELEMENT_NODE) {
        let new_parent = current_node.cloneNode(false);
        current_target.appendChild(new_parent);
        current_target = new_parent;
      }

      // Pick the next node
      if (current_node.hasChildNodes()) {
        current_node = current_node.firstChild;
      }
      else {
        while (current_node && ! current_node.nextSibling) {
          current_node = current_node.parentNode;
          current_target = current_target.parentNode;

          if (current_node === source) {
            current_node = null;
            break;
          }
        }

        if (current_node) {
          current_node = current_node.nextSibling;
        }
      }
    }

    // Start out with all letters hidden
    for (let letter of letters) {
      letter.classList.add('-letter');
      letter.classList.add('--hidden');
    }

    // And finally add it all to the DOM
    // TODO do something with old one...?  caller does atm, but
    this.phrase_element = mk('div.-phrase');
    this.phrase_element.appendChild(target);
    this.phrase_viewport_element = mk('div.-phrase-viewport');
    this.phrase_viewport_element.appendChild(this.phrase_element);
    this.phrase_wrapper_element = mk('div.-phrase-wrapper');
    this.phrase_wrapper_element.appendChild(this.phrase_viewport_element);
    this.element.appendChild(this.phrase_wrapper_element);
    this.letter_elements = letters;
    this.cursor = -1;
    this.chunk_cursor = -1;

    this.find_page_breaks();
  }

  find_page_breaks() {
    // Force a reflow and figure out how the text breaks into chunks
    // TODO maybe don't force a reflow?
    // TODO it would be cool if folks could scroll BACK through text if they missed something in the scroll
    // TODO it would also be cool if the text actually scrolled or something.  that would be pretty easy come to think of it
    // TODO this could be idle somewhat more efficiently (???) by guessing
    // the length of a line and looking for a break, or just binary
    // searching for breaks
    // TODO should this be totally empty if there's no text at all?
    // FIXME if the font becomes bigger partway through the first line of a
    // chunk, i THINK the y here will be wrong and the top of that line
    // will be cut off.  i could use the bottom of the previous line, but
    // in perverse cases that might be wrong too.  i may just have to scan
    // the whole line and use the min top value?
    this.chunks = [];
    if (this.letter_elements.length === 0) {
      // Nothing to do; no letters means no chunks!
      return;
    }

    // TODO explicitly clear transform first?

    // This rectangle describes the space available for filling with text
    let viewport = this.phrase_viewport_element.getBoundingClientRect();

    // TODO apply some word-break to this too, just in case?
    // TODO attempt to prevent orphans?

    // Chunks are really composed of lines, not characters.  It's
    // impossible to know for sure if a letter should go in a new chunk
    // without checking every letter in the same line, because various CSS
    // shenanigans might push some later letters lower.  Thus, the first
    // step is to find line divisions.
    let lines = [];
    let current_line = null;
    for (let [i, letter] of this.letter_elements.entries()) {
      let rect = letter.getBoundingClientRect();

      // This is harder than it really ought to be.  Line wraps aren't
      // actually exposed in the DOM, and every possible avenue involves
      // some amount of heuristic handwaving.  Here's the best I can do:
      // if the top of this letter is below every letter seen so far in
      // the line, it's probably a new line.  This doesn't work in
      // pathological cases where a word is placed significantly below
      // the baseline, so don't do that.  (And if you must, add some
      // padding so the top of the letter's box is a bit higher.)
      if (current_line === null || rect.top > current_line.y1) {
        current_line = {
          i0: i,
          i1: i,
          y0: rect.top,
          y1: rect.bottom,
        };
        lines.push(current_line);
      }
      else {
        current_line.i1 = i;

        if (rect.top < current_line.y0) {
          current_line.y0 = rect.top;
        }
        if (rect.bottom > current_line.y1) {
          current_line.y1 = rect.bottom;
        }
      }
    }

    // Now split those lines into chunks.  (This separate pass also has the
    // advantage that if a single line is taller than the viewport, it'll
    // become a single chunk, rather than pathological behavior like every
    // /letter/ becoming a chunk.)
    let current_chunk = null;
    for (let line of lines) {
      if (current_chunk === null || line.y1 > current_chunk.y0 + viewport.height) {
        // Avoid putting blank lines as the first thing in a chunk; it
        // looks super bad!
        if (line.i0 === line.i1 && this.letter_elements[line.i0].textContent === '\n') {
          current_chunk = null;
        }
        else {
          current_chunk = {
            first_letter_index: line.i0,
            last_letter_index: line.i1,
            // Everything so far has been in client coordinates,
            // but more useful is the position relative to the
            // container
            y0: line.y0,
            y1: line.y1,
          };
          this.chunks.push(current_chunk);
        }
      }
      else {
        current_chunk.last_letter_index = line.i1;
        current_chunk.y1 = line.y1;
      }
    }

    // Compute the offset to use to show the start of each chunk,
    // vertically centering it within the available space
    for (let chunk of this.chunks) {
      let text_height = chunk.y1 - chunk.y0;
      let relative_top = chunk.y0 - viewport.top;
      // XXX well, i thought this was a good idea, but it looks weird
      // with a single line left over and it looks REALLY weird with the
      // TAL panels
      //chunk.offset = relative_top - (viewport.height - text_height) / 2;
      chunk.offset = relative_top;
    }
  }

  _start_scrolling() {
    // Start scrolling the next text chunk into view, if any.
    //
    // Returns true iff there was any text to display.
    if (this.scroll_state === 'idle') {
      // Nothing left to do!
      return false;
    }

    if (this.chunk_cursor + 1 >= this.chunks.length) {
      this.scroll_state = 'idle';
      return false;
    }

    this.chunk_cursor++;
    let chunk = this.chunks[this.chunk_cursor];

    // If the scroll is starting midway through the text (presumably, at
    // the start of a line!), slide the text up so the next character is at
    // the top of the text box
    // TODO hm, actually, what if it's /not/ at the start of a line?
    // TODO should there be better text scrolling behavior?  like should
    // this scroll up by a line at a time after the first chunk, or scroll
    // up by a line at a time as it fills in the new chunk, or?  configurable??
    // TODO what if the audience does a text zoom at some point?  is there an event for that?  does resize fire?
    // FIXME this does a transition if the first chunk's offset isn't 0, looks bad.  dunno why, happens with tal panels but not regular dialogue
    this.phrase_element.style.transform = `translateY(-${chunk.offset}px)`;

    this.time = 0;
    this.scroll_state = 'scrolling';
  }

  update(dt) {
    if (this.scroll_state === 'idle') {
      return;
    }

    this.time += dt;

    // Reveal as many letters as appropriate
    let chunk = this.chunks[this.chunk_cursor];
    while (this.time > 0) {
      if (this.cursor + 1 >= this.letter_elements.length) {
        this.scroll_state = 'idle';
        return;
      }

      // If we hit the end of the chunk, stop here and wait for an advance
      if (this.cursor + 1 > chunk.last_letter_index) {
        this.scroll_state = 'waiting';
        return;
      }

      this.cursor++;
      let letter = this.letter_elements[this.cursor];
      letter.classList.remove('--hidden');
      this.time -= 1 / this.role.speed;

      if (letter.textContent === "\f") {
        this.time -= 0.5;
      }

      break;
    }
  }

  advance() {
    // Called when the audience tries to advance to the next beat.  Does a
    // couple interesting things:
    // 1. If the text is still scrolling, fill the textbox instantly.
    // 2. If the textbox is full but there's still more text to show,
    // clear it and continue scrolling.
    // In either case, the advancement is stopped.

    if (this.scroll_state === 'scrolling') {
      // Case 1: The phrase is still scrolling, so advancement means to
      // fill it as much as possible
      this.paused = false;

      let last_letter_index;
      if (this.chunk_cursor + 1 < this.chunks.length) {
        // There are more chunks
        last_letter_index = this.chunks[this.chunk_cursor + 1].first_letter_index - 1;
        this.scroll_state = 'waiting';
      }
      else {
        // This is the last chunk
        last_letter_index = this.letter_elements.length - 1;
        this.scroll_state = 'idle';
      }

      for (let i = this.cursor; i <= last_letter_index; i++) {
        this.letter_elements[i].classList.remove('--hidden');
      }

      let num_letters_shown = last_letter_index - this.cursor + 1;
      this.cursor = last_letter_index;

      // Special case: if the only thing left to show was the last letter
      // in the last chunk, let the advance go through; otherwise, an
      // impatient audience might feel like clicking did nothing
      if (num_letters_shown <= 1) {
        return true;
      }

      // But most of the time, block the advance
      return false;
    }
    else if (this.scroll_state === 'waiting') {
      // Case 2: more text to show

      // Hide the letters from any previous text shown
      for (let letter of this.letter_elements) {
        letter.classList.add('--hidden');
      }

      this._start_scrolling();

      return false;
    }
  }
}
/*
    reify: ($parent) ->
        $element = $ '<div>', class: 'cutscene--speech-bubble'
        $parent.append $element

        $element.data 'visited-labels': {}

        $element.on 'cutscene:change', @_change.bind this
        $element.on 'cutscene:menu', @_menu.bind this
        $element.on 'cutscene:hide', @_hide.bind this
        $element.on 'cutscene:disable', @_disable.bind this

        $element.on 'mouseenter', 'li', @_menu_hover.bind this
        $element.on 'click', 'li', (event) ->
            $selected = $(this)
            label = $selected.data('label')
            if label?
                event.stopImmediatePropagation()
                $element.data('visited-labels')[label] = true
                $parent.triggerHandler 'stage:jump', [label]

        $parent.on 'stage:next' + NS, (event) => @_possibly_fill event, $element
        $parent.on 'action:pause' + NS, (event) => @_pause event, $element
        $parent.on 'action:unpause' + NS, (event) => @_unpause event, $element

        $parent.on 'menu:next' + NS, (event) => @_menu_move event, 1
        $parent.on 'menu:prev' + NS, (event) => @_menu_move event, -1
        $parent.on 'menu:accept' + NS, (event) =>
            $selected = $element.find('li.-selected')
            label = $selected.data('label')
            if label?
                $element.data('visited-labels')[label] = true
                $parent.triggerHandler 'stage:jump', [label]

        return [$element, promise_always()]

    _menu: (event, labels_to_captions) ->
        $el = $ event.currentTarget

        # Check for a special JUMP_WHEN_COMPLETE caption -- if this exists, and
        # the player has visited all the other labels, we'll automatically jump
        # straight to that label
        visited_labels = $el.data 'visited-labels'
        all_visited = true
        when_complete_label = null
        for label, caption of labels_to_captions
            if caption == SpeechBubble.JUMP_WHEN_COMPLETE
                when_complete_label = label
            else if not visited_labels[label]
                all_visited = false
                break
        if all_visited and when_complete_label?
            $el.parent().triggerHandler 'stage:jump', [when_complete_label]
            return

        $el.removeClass '--hidden'
        $el.empty()
        # TODO dry; XXX remove speaker!!!
        $el.css
            backgroundColor: ''
            borderColor: ''

        $menu = $ '<ol>', class: 'cutscene--menu'
        for label, caption of labels_to_captions
            if caption == SpeechBubble.JUMP_WHEN_COMPLETE
                continue
            $menu.append $ '<li>', text: caption, data: label: label

        $menu.children().first().addClass '-selected'

        $el.append $menu

        # Even though this is a brand new element, browser history may keep it
        # scrolled
        $menu[0].scrollTop = 0

        return

    _menu_hover: (event) ->
        $el = $ event.delegateTarget
        $hovered = $ event.currentTarget

        $el.find('li').removeClass '-selected'
        $hovered.addClass '-selected'

    _menu_move: (event, direction) ->
        $el = $ event.currentTarget
        $menu = $el.find '.cutscene--menu'
        if not $menu.length
            return

        $target = $menu.children 'li.-selected'
        $target.removeClass '-selected'

        orig_direction = direction

        while direction > 0
            direction--
            $target = $target.next 'li'
            if not $target.length
                $target = $menu.children('li').first()

        while direction < 0
            direction++
            $target = $target.prev 'li'
            if not $target.length
                $target = $menu.children('li').last()

        $target.addClass '-selected'

        # Is the newly-selected item completely contained within its parent?
        ###
        menu_top = $menu[0].scrollTop
        item_top = $target[0].offsetTop
        menu_bottom = menu_top + $menu[0].offsetHeight
        item_bottom = item_top + $target[0].offsetHeight
        if item_bottom > menu_bottom
            $menu[0].scrollTop = item_bottom - $menu[0].offsetHeight
        if item_top < menu_top
            $menu[0].scrollTop = item_top


            ###
        if not ($menu[0].scrollTop <= $target[0].offsetTop <= $menu[0].scrollTop + $menu[0].offsetHeight - $target[0].offsetHeight)
            # Argument is whether to align with top, which we want to do iff we
            # scrolled upwards.  This also works if we wrapped around:
            # scrolling the topmost item into view "aligned with the bottom"
            # pushes it to the very top.
            $target[0].scrollIntoView orig_direction < 0

    _hide: (event) ->
        $el = $ event.currentTarget
        $el.addClass '--hidden'
        $el.text ''

    _disable: (event) ->
        $el = $ event.currentTarget
        $el.text ''
*/